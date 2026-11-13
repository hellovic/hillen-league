"""Regression tests run entirely on temporary copies; never scrape or publish."""
import contextlib
import datetime
import hashlib
import io
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import refresh_diff
import scraper
import server


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "league.db"
        with contextlib.closing(sqlite3.connect(ROOT / "hillen_league.db")) as src, contextlib.closing(sqlite3.connect(self.db)) as dst:
            src.backup(dst)
        self.store = scraper.Store(str(self.db))
        self.store.conn.row_factory = sqlite3.Row
        self.addCleanup(self.store.conn.close)

    def bytes_digest(self):
        return hashlib.sha256(self.db.read_bytes()).hexdigest()

    def test_invalid_source_aborts_without_touching_database(self):
        class BadSource:
            def get(self, *args, **kwargs):
                return '<html>Temporarily unavailable</html>'
        before = self.bytes_digest()
        with self.assertRaises(scraper.ScrapeError):
            scraper.refresh_database(str(self.db), [(33, 16)], BadSource())
        self.assertEqual(before, self.bytes_digest())

    def test_late_group_failure_rolls_back_entire_refresh(self):
        before = self.bytes_digest()
        def scrape(cache, store, season, group, incremental):
            store.conn.execute("UPDATE teams SET name='Changed in staging'")
            store.commit()
            if group == 27:
                raise scraper.ScrapeError("second group failed")
        with patch.object(scraper, "scrape_group", scrape), self.assertRaises(scraper.ScrapeError):
            scraper.refresh_database(str(self.db), [(32, 26), (32, 27)], None)
        self.assertEqual(before, self.bytes_digest())

    def test_failed_validation_does_not_promote(self):
        before = self.bytes_digest()
        def scrape(cache, store, *args):
            store.conn.execute("UPDATE games SET home_score=999 WHERE status='completed'")
            store.commit()
        with patch.object(scraper, "scrape_group", scrape), self.assertRaises(subprocess.CalledProcessError):
            scraper.refresh_database(str(self.db), [(32, 26)], None)
        self.assertEqual(before, self.bytes_digest())

    def test_no_change_preserves_bytes_and_refresh_timestamp(self):
        before = self.bytes_digest()
        with patch.object(scraper, "scrape_group"), contextlib.redirect_stdout(io.StringIO()):
            changed = scraper.refresh_database(str(self.db), [], None)
        self.assertFalse(changed)
        self.assertEqual(before, self.bytes_digest())

    def test_result_withdrawal_removes_details_and_player_totals(self):
        c = self.store.conn
        row = dict(c.execute("SELECT * FROM games WHERE status='completed' LIMIT 1").fetchone())
        eid = row["event_id"]
        self.assertGreater(c.execute("SELECT COUNT(*) FROM v_played_games WHERE event_id=?", (eid,)).fetchone()[0], 0)
        row.update(date=row.pop("game_date"), start=row.pop("start_time"), end=row.pop("end_time"),
                   status="scheduled", home_score=None, away_score=None)
        self.store.replace_game(row)
        for table in ("player_game_stats", "game_quarters", "game_team_stats", "v_played_games"):
            self.assertEqual(0, c.execute(f"SELECT COUNT(*) FROM {table} WHERE event_id=?", (eid,)).fetchone()[0])

    def test_view_and_validator_reject_stale_scheduled_statistics(self):
        c = self.store.conn
        eid = c.execute("SELECT event_id FROM games WHERE status='completed' LIMIT 1").fetchone()[0]
        c.execute("UPDATE games SET status='scheduled',home_score=NULL,away_score=NULL WHERE event_id=?", (eid,))
        c.commit()
        self.assertEqual(0, c.execute("SELECT COUNT(*) FROM v_played_games WHERE event_id=?", (eid,)).fetchone()[0])
        result = subprocess.run([sys.executable, str(ROOT / "validate.py"), "--db", str(self.db), "--quiet"], capture_output=True)
        self.assertEqual(result.returncode, 1)

    def test_digest_detects_assist_reassignment_and_fixture_details(self):
        c = self.store.conn
        donor = c.execute("SELECT event_id,player_id FROM player_game_stats WHERE ast>0 LIMIT 1").fetchone()
        receiver = c.execute("SELECT player_id FROM player_game_stats WHERE event_id=? AND player_id!=? AND ast IS NOT NULL LIMIT 1", tuple(donor)).fetchone()[0]
        before = refresh_diff.load_state(c)
        digest = refresh_diff.dataset_digest(c)
        c.execute("UPDATE player_game_stats SET ast=ast-1 WHERE event_id=? AND player_id=?", tuple(donor))
        c.execute("UPDATE player_game_stats SET ast=ast+1 WHERE event_id=? AND player_id=?", (donor[0], receiver))
        self.assertNotEqual(before, refresh_diff.load_state(c))
        self.assertNotEqual(digest, refresh_diff.dataset_digest(c))
        before = refresh_diff.load_state(c)
        c.execute("UPDATE games SET venue='Reassigned court',start_time='09:00 AM' WHERE event_id=?", (donor[0],))
        self.assertNotEqual(before, refresh_diff.load_state(c))

    def test_digest_includes_rosters_and_ignores_check_timestamp(self):
        c = self.store.conn
        before = refresh_diff.dataset_digest(c)
        c.execute("UPDATE refresh_meta SET value='2099-01-01' WHERE key='refreshed_at'")
        self.assertEqual(before, refresh_diff.dataset_digest(c))
        c.execute("DELETE FROM rosters WHERE rowid=(SELECT MIN(rowid) FROM rosters)")
        self.assertNotEqual(before, refresh_diff.dataset_digest(c))

    def test_unplayed_rank_changes_leave_digest_and_export_unchanged(self):
        c = self.store.conn
        scope = c.execute("SELECT season_id,group_id FROM standings WHERE gp=0 LIMIT 1").fetchone()
        digest = refresh_diff.dataset_digest(c)
        standings = server.standings_rows(c, *scope)
        c.execute("UPDATE standings SET rank=rank+100 WHERE gp=0")
        self.assertEqual(digest, refresh_diff.dataset_digest(c))
        self.assertEqual(standings, server.standings_rows(c, *scope))
        c.execute("UPDATE standings SET rank=rank+100 WHERE gp>0")
        self.assertNotEqual(digest, refresh_diff.dataset_digest(c))

    def test_request_memoization_reuses_fresh_season_page(self):
        fetcher = scraper.Fetcher.__new__(scraper.Fetcher)
        fetcher.responses = {"season-page": "fresh response"}
        fetcher.memory_hits = 0
        self.assertEqual("fresh response", fetcher.get("season-page"))

    def test_placeholder_captain_does_not_erase_existing_name(self):
        c = self.store.conn
        pid, name = c.execute("SELECT player_id,name FROM players WHERE name!='' LIMIT 1").fetchone()
        self.store.upsert_player(pid, "")
        self.assertEqual(name, c.execute("SELECT name FROM players WHERE player_id=?", (pid,)).fetchone()[0])

    def test_changed_schedule_markup_is_not_treated_as_deleted_games(self):
        html = '<li><div class="new-fixture-class"><span>YOUTH GIRLS U13</span><a href="scores.php?event_id=17664">Result</a></div></li>'
        with self.assertRaises(scraper.ScrapeError):
            scraper.require_schedule_rows(html, "YOUTH GIRLS U13", [])

    def test_fixture_corrections_and_recent_results_bypass_score_cache(self):
        row = self.store.conn.execute("SELECT status,home_score,away_score,game_date,start_time,end_time,venue FROM games WHERE status='completed' ORDER BY game_date LIMIT 1").fetchone()
        event = dict(zip(("status", "home_score", "away_score", "date", "start", "end", "venue"), row))
        date = datetime.date.fromisoformat(event["date"])
        later = date + datetime.timedelta(days=30)
        self.assertEqual(7 * 86400, scraper.settled_score_age(row, event, True, later))
        self.assertEqual(15 * 60, scraper.settled_score_age(row, event, True, date))
        self.assertIsNone(scraper.settled_score_age(row, event, False, later))
        for key, value in (("date", (date + datetime.timedelta(days=1)).isoformat()),
                           ("start", "11:00 PM"), ("venue", "Corrected court"),
                           ("home_score", event["home_score"] + 1)):
            self.assertIsNone(scraper.settled_score_age(row, {**event, key: value}, True, later), key)

    def test_listing_disappearance_preserves_recorded_results_and_voids(self):
        c = self.store.conn
        before = {r[0] for r in c.execute("SELECT event_id FROM games WHERE status!='scheduled'")}
        pending = {r[0] for r in c.execute("SELECT event_id FROM games WHERE status='scheduled'")}
        if not pending:
            eid = c.execute("SELECT MAX(event_id)+1 FROM games").fetchone()[0]
            row = c.execute("SELECT season_id,group_id,home_team_id,away_team_id FROM games LIMIT 1").fetchone()
            c.execute("INSERT INTO games(event_id,season_id,group_id,home_team_id,away_team_id,status) VALUES(?,?,?,?,?,'scheduled')", (eid, *row))
            pending = {eid}
        self.assertTrue(before)
        self.assertTrue(pending)
        for season, group in c.execute("SELECT season_id,group_id FROM groups").fetchall():
            self.store.prune_pending_games(season, group, set())
        after = {r[0] for r in c.execute("SELECT event_id FROM games")}
        self.assertEqual(before, after)
        self.assertFalse(after & pending)


if __name__ == "__main__":
    unittest.main()
