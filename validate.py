#!/usr/bin/env python3
"""
Hillen League data validation suite.

Runs reconciliation checks over hillen_league.db that should ALWAYS hold after
a successful scrape. Exits with code 1 on any failure, 0 otherwise.

Checks:
  1. Box-score PTS sums match official game scores (per team, completed games)
  2. Quarter sums (Q1..OT) match final scores (completed games with quarters)
  3. Computed team records (v_team_season_totals) match the official standings
  4. Forfeit games: all box rows have 0:00 minutes; scores present
  5. Not-played games: no box rows; NULL scores
  6. DNP rule: season-stat view counts exactly the games with minutes > 0
  7. Referential integrity of games/player_game_stats/rosters/players/teams

Usage:
    python3 validate.py [--db hillen_league.db] [--quiet]
"""

import argparse
import sqlite3
import sys

CHECKS = {}


def check(name):
    def deco(fn):
        CHECKS[name] = fn
        return fn
    return deco


def main():
    ap = argparse.ArgumentParser(description="Hillen League data validation")
    ap.add_argument("--db", default="hillen_league.db")
    ap.add_argument("--quiet", action="store_true", help="only print failures")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    failures, warnings = [], []

    def fail(msg):
        failures.append(msg)
        if not args.quiet:
            print("FAIL:", msg)

    def warn(msg):
        warnings.append(msg)
        if not args.quiet:
            print("WARN:", msg)

    # ---- 1. box-score PTS vs official score ----
    @check("box-score sums match official scores")
    def _(c):
        bad = 0
        for g in c.execute("SELECT * FROM games WHERE status='completed'"):
            for team_id, official in ((g["home_team_id"], g["home_score"]),
                                      (g["away_team_id"], g["away_score"])):
                total = c.execute(
                    "SELECT COALESCE(SUM(pts), 0) FROM player_game_stats "
                    "WHERE event_id=? AND team_id=?", (g["event_id"], team_id)).fetchone()[0]
                if total != official:
                    bad += 1
                    fail(f"event {g['event_id']}: box PTS {total} != official {official} (team {team_id})")
        return bad

    # ---- 2. quarter sums vs final ----
    @check("quarter sums match final scores")
    def _(c):
        bad = 0
        for q in c.execute("SELECT * FROM game_quarters"):
            if any(q[k] is None for k in ("q1", "q2", "q3", "q4", "ot")):
                continue
            total = q["q1"] + q["q2"] + q["q3"] + q["q4"] + q["ot"]
            g = c.execute("SELECT * FROM games WHERE event_id=?", (q["event_id"],)).fetchone()
            if not g or g["status"] != "completed":
                continue
            official = g["home_score"] if q["team_id"] == g["home_team_id"] else g["away_score"]
            if total != official:
                bad += 1
                fail(f"event {q['event_id']} team {q['team_id']}: quarters {total} != final {official}")
        return bad

    # ---- 3. standings vs computed ----
    @check("computed team records match official standings")
    def _(c):
        bad = 0
        rows = c.execute("""
            SELECT stn.season_id, stn.group_id, stn.team_id, stn.gp, stn.wins, stn.losses, stn.forfeits,
                   v.gp AS vgp, v.wins AS vwins, v.losses AS vlosses, v.forfeits AS vforfeits
            FROM standings stn
            LEFT JOIN v_team_season_totals v
              ON v.team_id = stn.team_id AND v.season_id = stn.season_id""").fetchall()
        for r in rows:
            st = (r["gp"], r["wins"], r["losses"], r["forfeits"])
            cmp_ = (r["vgp"], r["vwins"], r["vlosses"], r["vforfeits"])
            # a team that never played has a standings row of zeros but no computed row
            if st == (0, 0, 0, 0) and cmp_ == (None, None, None, None):
                continue
            if st != cmp_:
                bad += 1
                fail(f"g{r['group_id']} team {r['team_id']}: standings "
                     f"{r['gp']}-{r['wins']}-{r['losses']}-{r['forfeits']} vs computed "
                     f"{r['vgp']}-{r['vwins']}-{r['vlosses']}-{r['vforfeits']}")
        # teams with games but missing from standings
        for r in c.execute("""
                SELECT v.team_id, v.season_id FROM v_team_season_totals v
                LEFT JOIN standings s ON s.team_id = v.team_id AND s.season_id = v.season_id
                WHERE s.team_id IS NULL"""):
            warn(f"team {r['team_id']} has games but no official standings row (season {r['season_id']})")
        return bad

    # ---- 4. forfeit games ----
    @check("forfeit games have no played minutes")
    def _(c):
        bad = 0
        for g in c.execute("SELECT * FROM games WHERE status='forfeit'"):
            if g["home_score"] is None or g["away_score"] is None:
                bad += 1
                fail(f"forfeit event {g['event_id']} has NULL scores")
            rows = c.execute("SELECT * FROM player_game_stats WHERE event_id=?",
                             (g["event_id"],)).fetchall()
            if not rows:
                continue
            for r in rows:
                if r["minutes"] not in ("0:00", None, ""):
                    bad += 1
                    fail(f"forfeit event {g['event_id']}: player {r['player_id']} has minutes {r['minutes']!r}")
        return bad

    # ---- 5. not-played games ----
    @check("not-played games have no box rows and NULL scores")
    def _(c):
        bad = 0
        for g in c.execute("SELECT * FROM games WHERE status='not_played'"):
            if g["home_score"] is not None or g["away_score"] is not None:
                bad += 1
                fail(f"not_played event {g['event_id']} has non-NULL scores")
            n = c.execute("SELECT COUNT(*) FROM player_game_stats WHERE event_id=?",
                          (g["event_id"],)).fetchone()[0]
            if n:
                bad += 1
                fail(f"not_played event {g['event_id']} has {n} box rows")
        return bad

    # ---- 6. DNP rule: view counts exactly played games ----
    @check("player season stats count only played games (minutes > 0)")
    def _(c):
        bad = 0
        view = c.execute("""
            SELECT player_id, season_id, team_id, group_id, gp FROM v_player_season_totals""").fetchall()
        raw = c.execute("""
            SELECT p.player_id, g.season_id, p.team_id, g.group_id, COUNT(*) AS n
            FROM player_game_stats p
            JOIN games g ON g.event_id = p.event_id
            WHERE p.minutes IS NOT NULL AND p.minutes != '' AND p.minutes != '0:00'
            GROUP BY p.player_id, g.season_id, p.team_id, g.group_id""").fetchall()
        view_map = {(r["player_id"], r["season_id"], r["team_id"], r["group_id"]): r["gp"] for r in view}
        raw_map = {(r["player_id"], r["season_id"], r["team_id"], r["group_id"]): r["n"] for r in raw}
        for key, n in raw_map.items():
            if view_map.get(key) != n:
                bad += 1
                fail(f"player {key[0]} (s{key[1]}): raw played games {n} but view gp {view_map.get(key)}")
        for key, gp in view_map.items():
            if key not in raw_map:
                bad += 1
                fail(f"player {key[0]} (s{key[1]}): view gp {gp} but no played games in raw data")
        # no view row may have zero/negative minutes
        for r in c.execute("SELECT player_id FROM v_player_season_totals WHERE minutes <= 0"):
            bad += 1
            fail(f"player {r['player_id']}: view minutes <= 0")
        return bad

    # ---- 7. referential integrity ----
    @check("referential integrity")
    def _(c):
        bad = 0
        q = {
            "player_game_stats orphan event": "SELECT COUNT(*) FROM player_game_stats p LEFT JOIN games g ON g.event_id=p.event_id WHERE g.event_id IS NULL",
            "player_game_stats orphan player": "SELECT COUNT(*) FROM player_game_stats p LEFT JOIN players pl ON pl.player_id=p.player_id WHERE pl.player_id IS NULL",
            "player_game_stats orphan team": "SELECT COUNT(*) FROM player_game_stats p LEFT JOIN teams t ON t.team_id=p.team_id WHERE t.team_id IS NULL",
            "games orphan home team": "SELECT COUNT(*) FROM games g LEFT JOIN teams t ON t.team_id=g.home_team_id WHERE t.team_id IS NULL",
            "games orphan away team": "SELECT COUNT(*) FROM games g LEFT JOIN teams t ON t.team_id=g.away_team_id WHERE t.team_id IS NULL",
            "rosters orphan player": "SELECT COUNT(*) FROM rosters r LEFT JOIN players p ON p.player_id=r.player_id WHERE p.player_id IS NULL",
            "rosters orphan team": "SELECT COUNT(*) FROM rosters r LEFT JOIN teams t ON t.team_id=r.team_id WHERE t.team_id IS NULL",
        }
        for label, sql in q.items():
            n = c.execute(sql).fetchone()[0]
            if n:
                bad += 1
                fail(f"{label}: {n}")
        # warnings: box players not on official roster
        for r in c.execute("""
                SELECT DISTINCT p.player_id, p.team_id FROM player_game_stats p
                LEFT JOIN rosters r ON r.player_id = p.player_id AND r.team_id = p.team_id
                WHERE r.player_id IS NULL"""):
            warn(f"box-score player {r['player_id']} not on official roster of team {r['team_id']}")
        return bad

    total_failures = 0
    for name, fn in CHECKS.items():
        total_failures += fn(conn)
    conn.close()

    print(f"validate: {len(CHECKS)} checks · {total_failures} failure(s) · {len(warnings)} warning(s)")
    return 1 if total_failures else 0


if __name__ == "__main__":
    sys.exit(main())
