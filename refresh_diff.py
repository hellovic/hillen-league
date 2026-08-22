#!/usr/bin/env python3
"""
refresh_diff.py — show what a refresh changed in hillen_league.db.

Used by refresh_and_push.sh / start.sh: snapshot the games state before
re-scraping, then diff afterwards to highlight new / updated / removed games.

Usage:
    python3 refresh_diff.py snapshot FILE [--db hillen_league.db]
    python3 refresh_diff.py diff FILE [--db hillen_league.db] [--summary]
"""

import argparse
import json
import sqlite3
import sys

# colour the console output only when it goes to a real terminal (not a pipe/log)
COLOR = sys.stdout.isatty()


def c(code, s):
    return f"\033[{code}m{s}\033[0m" if COLOR else s


def green(s):
    return c("32", s)


def yellow(s):
    return c("33", s)


def red(s):
    return c("31", s)


def bold(s):
    return c("1", s)


def load_state(conn):
    return [dict(r) for r in conn.execute("""
        SELECT g.event_id, g.season_id, g.group_id, g.status, g.game_date,
               g.home_team_id, g.away_team_id, g.home_score, g.away_score,
               (SELECT COUNT(*) FROM player_game_stats p
                 WHERE p.event_id = g.event_id) AS box_rows
        FROM games g""").fetchall()]


def group_name(conn, season_id, group_id):
    row = conn.execute("SELECT name FROM groups WHERE season_id=? AND group_id=?",
                       (season_id, group_id)).fetchone()
    return row[0] if row else f"group {group_id}"


def score(g):
    if g["home_score"] is None or g["away_score"] is None:
        return None
    return f"{g['home_score']}-{g['away_score']}"


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

    new = [e for e in after_map if e not in before_map]
    removed = [e for e in before_map if e not in after_map]
    updated = []
    for eid in set(before_map) & set(after_map):
        a, b = before_map[eid], after_map[eid]
        if (a["status"], a["home_score"], a["away_score"], a["box_rows"]) != \
           (b["status"], b["home_score"], b["away_score"], b["box_rows"]):
            updated.append(eid)

    unchanged = len(after) - len(new) - len(updated) - len(removed)

    if summary_only:
        print(f"{len(new)} new, {len(updated)} updated, {len(removed)} removed, "
              f"{unchanged} unchanged")
        return 0

    def game_line(g):
        home = names.get(g["home_team_id"], str(g["home_team_id"]))
        away = names.get(g["away_team_id"], str(g["away_team_id"]))
        return (f"{g['game_date']}  {home} vs {away}  "
                f"[event {g['event_id']}]  ·  {group_name(conn, g['season_id'], g['group_id'])} (s{g['season_id']})")

    print(bold("==> What changed in this refresh"))
    print()
    if new:
        print(bold(f"  NEW games ({len(new)}):"))
        for eid in sorted(new):
            g = after_map[eid]
            sc = score(g)
            tail = f" · {g['status']}" + (f" ({sc})" if sc else "")
            print(green(f"    +") + "  " + game_line(g) + tail)
        print()
    if updated:
        print(bold(f"  UPDATED games ({len(updated)}):"))
        for eid in sorted(updated):
            a, b = before_map[eid], after_map[eid]
            parts = []
            if a["status"] != b["status"]:
                parts.append(f"status {a['status']} → {b['status']}")
            sa, sb = score(a), score(b)
            if sa != sb:
                parts.append("result → " + sb if sa is None else f"score {sa} → {sb}")
            if a["box_rows"] != b["box_rows"]:
                parts.append(f"box rows {a['box_rows']} → {b['box_rows']}")
            print(yellow("    ~") + "  " + game_line(b))
            print("       ↳ " + yellow(", ".join(parts)))
        print()
    if removed:
        print(bold(f"  REMOVED games ({len(removed)}):"))
        for eid in sorted(removed):
            print(red("    -") + "  " + f"event {eid}  {before_map[eid]['game_date']}")
        print()
    if not (new or updated or removed):
        print("  " + c("90", "no changes — the site hasn't published anything new."))
    print(bold(f"  {len(after)} games total · {len(new)} new · {len(updated)} updated · {len(removed)} removed"))
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
