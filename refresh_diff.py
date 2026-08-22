#!/usr/bin/env python3
"""
refresh_diff.py — show what a refresh changed in hillen_league.db.

Used by refresh_and_push.sh: snapshot the games state before re-scraping,
then diff afterwards to highlight new / updated / removed games.

Usage:
    python3 refresh_diff.py snapshot FILE [--db hillen_league.db]
    python3 refresh_diff.py diff FILE [--db hillen_league.db] [--summary]
"""

import argparse
import json
import sqlite3
import sys


def load_state(conn):
    return [dict(r) for r in conn.execute("""
        SELECT g.event_id, g.season_id, g.group_id, g.status, g.game_date,
               g.home_team_id, g.away_team_id, g.home_score, g.away_score,
               (SELECT COUNT(*) FROM player_game_stats p
                 WHERE p.event_id = g.event_id) AS box_rows
        FROM games g""").fetchall()]


def fmt_game(conn, g, names):
    home = names.get(g["home_team_id"], str(g["home_team_id"]))
    away = names.get(g["away_team_id"], str(g["away_team_id"]))
    grp = conn.execute("SELECT name FROM groups WHERE season_id=? AND group_id=?",
                       (g["season_id"], g["group_id"])).fetchone()
    grp = grp[0] if grp else f"g{g['group_id']}"
    score = f"{g['home_score']}-{g['away_score']}" if g["home_score"] is not None else "—"
    return f"event {g['event_id']} (s{g['season_id']} {grp}) {g['game_date']} {home} {score} {away}"


def snapshot(conn, path):
    state = load_state(conn)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"games": state}, f, ensure_ascii=False)
    print(f"snapshot saved: {len(state)} games -> {path}")


def diff(conn, path, summary_only=False):
    try:
        with open(path, encoding="utf-8") as f:
            before = json.load(f)["games"]
    except FileNotFoundError:
        print("no previous snapshot — run `snapshot` before refreshing")
        return 1
    before_map = {g["event_id"]: g for g in before}
    after = load_state(conn)
    after_map = {g["event_id"]: g for g in after}
    names = dict(conn.execute("SELECT team_id, name FROM teams"))

    new_events = [e for e in after_map if e not in before_map]
    removed = [e for e in before_map if e not in after_map]
    updated = []
    for eid in set(before_map) & set(after_map):
        a, b = before_map[eid], after_map[eid]
        if (a["status"], a["home_score"], a["away_score"], a["box_rows"]) != \
           (b["status"], b["home_score"], b["away_score"], b["box_rows"]):
            updated.append(eid)

    if summary_only:
        print(f"{len(new_events)} new, {len(updated)} updated, {len(removed)} removed, "
              f"{len(after) - len(new_events) - len(updated) - len(removed)} unchanged")
        return 0

    print("==> What changed in this refresh")
    for eid in sorted(new_events):
        g = after_map[eid]
        print(f"  NEW    {fmt_game(conn, g, names)} — {g['status']}")
    for eid in sorted(updated):
        a, b = before_map[eid], after_map[eid]
        bits = []
        if a["status"] != b["status"]:
            bits.append(f"status {a['status']} → {b['status']}")
        if (a["home_score"], a["away_score"]) != (b["home_score"], b["away_score"]):
            bits.append(f"score {a['home_score']}-{a['away_score']} → {b['home_score']}-{b['away_score']}")
        if a["box_rows"] != b["box_rows"]:
            bits.append(f"box rows {a['box_rows']} → {b['box_rows']}")
        print(f"  UPDATE {fmt_game(conn, b, names)}: {', '.join(bits)}")
    for eid in sorted(removed):
        print(f"  REMOVED event {eid}")
    print(f"  {len(after)} games total · {len(new_events)} new · {len(updated)} updated · "
          f"{len(removed)} removed")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Snapshot/diff Hillen League games state")
    ap.add_argument("mode", choices=("snapshot", "diff"))
    ap.add_argument("path", help="snapshot JSON file")
    ap.add_argument("--db", default="hillen_league.db")
    ap.add_argument("--summary", action="store_true", help="one-line summary only (diff mode)")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    if args.mode == "snapshot":
        snapshot(conn, args.path)
        return 0
    return diff(conn, args.path, args.summary)


if __name__ == "__main__":
    sys.exit(main())
