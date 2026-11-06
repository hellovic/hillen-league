"""Guard division identity and preservation of ambiguous source player IDs."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
import scraper


class BoysExpansionTests(unittest.TestCase):
    def test_standings_match_exact_division_not_prefix(self):
        def table(label, tid):
            cells = ''.join(f'<div class="t-col">{v}</div>' for v in ['Team', 1, 1, 0, 0, 4, 2])
            return f'<h3 class="element-title"><span class="myfont">{label}分組表</span></h3><div class="widget"><li><a href="?team_id={tid}"></a>{cells}</li></div>'
        html = table('YOUTH U13', 1) + table('YOUTH U13 GROUP A', 2) + table('YOUTH GIRLS U13', 3)
        self.assertEqual([1], [r['team_id'] for r in scraper.parse_standings(html, 'YOUTH U13')])
        self.assertEqual([3], [r['team_id'] for r in scraper.parse_standings(html, 'YOUTH GIRLS U13')])

    def test_schedule_guard_excludes_similarly_named_groups_but_rejects_missing_row(self):
        html = '<li><span>YOUTH U13</span><a href="?event_id=1"></a></li><li><span>YOUTH U13 GROUP A</span><a href="?event_id=2"></a></li>'
        scraper.require_schedule_rows(html, 'YOUTH U13', [{'event_id': 1, 'group': 'YOUTH U13'}])
        with self.assertRaises(scraper.ScrapeError):
            scraper.require_schedule_rows(html, 'YOUTH U13', [])

    def test_shared_player_id_retains_both_teams_and_updates_independently(self):
        with tempfile.TemporaryDirectory() as folder:
            store = scraper.Store(str(Path(folder) / 'league.db'))
            try:
                store.conn.execute('PRAGMA foreign_keys=OFF')
                for tid in [1, 2]:
                    store.upsert_box({'event_id': 20869, 'team_id': tid, 'player_id': 13639, 'pts': tid})
                store.upsert_box({'event_id': 20869, 'team_id': 1, 'player_id': 13639, 'pts': 9})
                self.assertEqual([(1, 9), (2, 2)], store.conn.execute('SELECT team_id,pts FROM player_game_stats ORDER BY team_id').fetchall())
            finally:
                store.conn.close()
