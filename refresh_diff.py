#!/usr/bin/env python3
"""
refresh_diff.py — show what a refresh changed in hillen_league.db.

Used by refresh_and_push.sh / start.sh: snapshot the games state before
re-scraping, then diff afterwards to highlight new / updated / removed games.

Snapshot format v2 records each game's fixture date, season/group, teams and a
box-score stat checksum, so a moved fixture or a corrected player stat counts as
"updated". v1 snapshots (format without a "version" key) still diff, but only on
status/score/box-row count.

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


# Bump when load_state() starts recording more fields: diff() compares the new
# fields only for snapshots that declare at least this version.
SNAPSHOT_VERSION = 2


def load_state(conn):
    return [dict(r) for r in conn.execute("""
        SELECT g.event_id, g.season_id, g.group_id, g.status, g.game_date,
               g.home_team_id, g.away_team_id, g.home_score, g.away_score,
               (SELECT COUNT(*) FROM player_game_stats p
                 WHERE p.event_id = g.event_id) AS box_rows,
               (SELECT COALESCE(SUM(
                          p.pts + p.ast + p.stl + p.blk + p.eff + p.tov + p.pf
                          + p.fb + p.ba + p.fgm + p.fga + p.fg3m + p.fg3a
                          + p.ftm + p.fta + p.off_reb + p.def_reb + p.tot_reb
                          + p.plus_minus), 0)
                  FROM player_game_stats p
                 WHERE p.event_id = g.event_id) AS box_stats
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
        json.dump({"version": SNAPSHOT_VERSION, "games": state}, f, ensure_ascii=False)
    print(f"snapshot saved: {len(state)} games -> {path}")


def diff(conn, path, summary_only=False):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("no previous snapshot — run `snapshot` before refreshing")
        return 1
    # v1 snapshots were a bare {"games": [...]} without a version key; on those
    # the newer fields are absent, so compare only what they actually recorded.
    legacy = not (isinstance(data, dict) and data.get("version", 1) >= SNAPSHOT_VERSION)
    before = data["games"] if isinstance(data, dict) else data
    if legacy:
        print("note: legacy snapshot — date/team/player-stat edits are not compared; "
              "run `snapshot` again to upgrade", file=sys.stderr)
    before_map = {g["event_id"]: g for g in before}
    after = load_state(conn)
    after_map = {g["event_id"]: g for g in after}
    names = dict(conn.execute("SELECT team_id, name FROM teams"))

    new = [e for e in after_map if e not in before_map]
    removed = [e for e in before_map if e not in after_map]
    updated = []
    compared = ["status", "home_score", "away_score", "box_rows"]
    if not legacy:
        compared += ["season_id", "group_id", "game_date", "home_team_id",
                     "away_team_id", "box_stats"]
    for eid in set(before_map) & set(after_map):
        a, b = before_map[eid], after_map[eid]
        if any(a.get(k) != b.get(k) for k in compared):
            updated.append(eid)

    # "unchanged" counts games present in both snapshots: a removed game is not
    # unchanged, and must not be subtracted twice either.
    unchanged = len(after) - len(new) - len(updated)

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
            if not legacy:
                if a.get("game_date") != b.get("game_date"):
                    parts.append(f"date {a.get('game_date')} → {b.get('game_date')}")
                if (a.get("season_id"), a.get("group_id")) != (b.get("season_id"), b.get("group_id")):
                    parts.append(f"group s{a.get('season_id')}/g{a.get('group_id')} "
                                 f"→ s{b.get('season_id')}/g{b.get('group_id')}")
                if (a.get("home_team_id"), a.get("away_team_id")) != \
                   (b.get("home_team_id"), b.get("away_team_id")):
                    parts.append("teams changed")
                if a.get("box_stats") != b.get("box_stats"):
                    parts.append("box-score stats changed")
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
