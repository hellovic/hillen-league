#!/usr/bin/env python3
"""
crosscheck.py — deployed-dashboard vs source-site validator.

For every game and every player in the deployed dashboard
(https://hellovic.github.io/hillen-league/, the static JSON export of this
repo), randomly sample 10 per-player stats and compare each value against the
source of truth (https://www.hillen-sports.com/hillenyouth/ scores.php pages).

Usage:
    python3 crosscheck.py                   # deployed JSON vs LIVE source pages
    python3 crosscheck.py --use-cache       # vs cached source snapshots (offline / fast)
    python3 crosscheck.py --local-docs      # read deployed JSON from ./docs instead of GitHub Pages
    python3 crosscheck.py --sample 10 --seed 42

Exit codes:
    0  all compared stats match
    1  one or more discrepancies found
    2  operational failure (network/parse) — comparison incomplete
"""

import argparse
import json
import os
import random
import sys
import urllib.request

from scraper import BASE as SOURCE_BASE
from scraper import Fetcher, parse_scores_page

DEPLOYED_BASE = "https://hellovic.github.io/hillen-league"
LOCAL_DOCS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Comparable per-player stat fields: deployed JSON key -> source parse key.
# Both sides carry every field below (28 fields; the validator samples 10).
STAT_FIELDS = [
    ("jersey_no", "jersey_no"), ("minutes", "minutes"),
    ("fg2m", "2PT_m"), ("fg2a", "2PT_a"), ("fg2_pct", "2PT_pct"),
    ("fg3m", "3PT_m"), ("fg3a", "3PT_a"), ("fg3_pct", "3PT_pct"),
    ("fgm", "FG_m"), ("fga", "FG_a"), ("fg_pct", "FG_pct"),
    ("ftm", "FT_m"), ("fta", "FT_a"), ("ft_pct", "FT_pct"),
    ("off_reb", "off_reb"), ("def_reb", "def_reb"), ("tot_reb", "tot_reb"),
    ("ast", "ast"), ("stl", "stl"), ("blk", "blk"), ("fb", "fb"),
    ("ba", "ba"), ("tov", "tov"), ("pf", "pf"), ("eff", "eff"),
    ("plus_minus", "plus_minus"), ("pts", "pts"),
]


def values_equal(a, b):
    """Compare a deployed value with the corresponding source value."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a) - float(b)) <= 0.05 + 1e-9
        except (TypeError, ValueError):
            return False
    if isinstance(a, str) or isinstance(b, str):
        return str(a) == str(b)
    return a == b


class DeployedReader:
    """Reads the deployed dashboard's JSON, either live from GitHub Pages or
    from the local ./docs export."""

    def __init__(self, base):
        self.base = base
        self.local = not base.startswith("http")

    def read_json(self, rel):
        if self.local:
            path = os.path.join(self.base, "data", *rel.split("/"))
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        url = f"{self.base}/data/{rel}"
        last = None
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                last = exc
        raise RuntimeError(f"deployed data unreachable: {url} ({last})")


def check_group(deployed, fetcher, season, group, rng, sample):
    """Validate one season+group. Returns (rows, stats_compared, mismatches,
    game_mismatches, discrepancies)."""
    games = deployed.read_json(f"{season}/{group}/games.json")
    deep = sorted([g for g in games if g.get("status") in ("completed", "forfeit")],
                  key=lambda g: g["event_id"])
    light = sorted([g for g in games if g not in deep], key=lambda g: g["event_id"])

    rows = stats_compared = mismatches = game_mismatches = 0
    disc = []

    for g in deep:
        eid = g["event_id"]
        dgame = deployed.read_json(f"{season}/{group}/games/{eid}.json")
        src = parse_scores_page(
            fetcher.get(f"{SOURCE_BASE}scores.php?season_id={season}&event_id={eid}"),
            season, eid)

        if src["home_team_id"] is None:
            disc.append({"type": "source_unparseable", "event": eid, "group": group,
                         "detail": "scores.php page could not be parsed"})
            continue
        if (src["home_score"], src["away_score"]) != (dgame["home_score"], dgame["away_score"]):
            game_mismatches += 1
            disc.append({"type": "score", "event": eid, "group": group,
                         "detail": f"deployed {dgame['home_score']}-{dgame['away_score']} "
                                   f"vs source {src['home_score']}-{src['away_score']}"})
        if src["status"] != dgame["status"]:
            game_mismatches += 1
            disc.append({"type": "status", "event": eid, "group": group,
                         "detail": f"deployed '{dgame['status']}' vs source '{src['status']}'"})

        dbox = {r["player_id"]: r for r in dgame["box"]}
        sbox = {r["player_id"]: r for r in src["box"]}

        for pid in sorted(dbox):
            drow, srow = dbox[pid], sbox.get(pid)
            rows += 1
            if srow is None:
                disc.append({"type": "player_missing_source", "event": eid, "group": group,
                             "player_id": pid,
                             "detail": f"{drow.get('player_name')} in deployed box but not on source"})
                continue
            for dk, sk in rng.sample(STAT_FIELDS, min(sample, len(STAT_FIELDS))):
                stats_compared += 1
                if not values_equal(drow.get(dk), srow.get(sk)):
                    mismatches += 1
                    disc.append({"type": "stat", "event": eid, "group": group,
                                 "player_id": pid,
                                 "detail": f"{drow.get('player_name')} {dk}: "
                                           f"deployed {drow.get(dk)!r} vs source {srow.get(sk)!r}"})
        for pid in sorted(set(sbox) - set(dbox)):
            disc.append({"type": "player_missing_deployed", "event": eid, "group": group,
                         "player_id": pid,
                         "detail": f"{sbox[pid].get('name')} on source box but not in deployed"})

    for g in light:
        eid = g["event_id"]
        dgame = deployed.read_json(f"{season}/{group}/games/{eid}.json")
        src = parse_scores_page(
            fetcher.get(f"{SOURCE_BASE}scores.php?season_id={season}&event_id={eid}"),
            season, eid)
        if src["box"] and not dgame["box"]:
            game_mismatches += 1
            disc.append({"type": "unexpected_source_box", "event": eid, "group": group,
                         "detail": f"deployed '{dgame['status']}' has no box but source has "
                                   f"{len(src['box'])} player rows"})

    return rows, stats_compared, mismatches, game_mismatches, disc


def main():
    ap = argparse.ArgumentParser(description="Validate deployed dashboard vs hillen-sports.com source")
    ap.add_argument("--sample", type=int, default=10, help="stats sampled per player per game (default 10)")
    ap.add_argument("--seed", default="42", help="RNG seed; 'random' for non-deterministic (default 42)")
    ap.add_argument("--use-cache", action="store_true",
                    help="compare against cached source pages instead of fetching live")
    ap.add_argument("--local-docs", action="store_true",
                    help="read deployed JSON from ./docs instead of the live GitHub Pages site")
    ap.add_argument("--season", type=int, default=None, help="restrict to one season (default: all in meta)")
    ap.add_argument("--group", type=int, default=None, help="restrict to one group id")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    deployed = DeployedReader(LOCAL_DOCS if args.local_docs else DEPLOYED_BASE)
    fetcher = Fetcher(os.path.join(here, "cache"), refresh=not args.use_cache, delay=0.4)
    rng = random.Random(None if args.seed == "random" else int(args.seed))

    try:
        meta = deployed.read_json("meta.json")
    except RuntimeError as exc:
        print(f"crosscheck: FAILED — {exc}", file=sys.stderr)
        return 2

    group_names = {g["group_id"]: g["name"] for g in meta["groups"]}
    combos = [c for c in meta["combos"]
              if (args.season is None or c["season"] == args.season)
              and (args.group is None or c["group"] == args.group)]
    if not combos:
        print("crosscheck: no season/group combos selected", file=sys.stderr)
        return 2

    source_mode = "cache" if args.use_cache else "LIVE"
    print(f"crosscheck: deployed={deployed.base}  source={SOURCE_BASE} ({source_mode})  "
          f"sample={args.sample} stats/player/game  seed={args.seed}")

    totals = {"games": 0, "rows": 0, "stats": 0, "mismatches": 0, "game_mismatches": 0}
    all_disc = []

    for c in combos:
        season, group = c["season"], c["group"]
        rows, stats, mm, gm, disc = check_group(deployed, fetcher, season, group, rng, args.sample)
        gname = group_names.get(group, f"group {group}")
        totals["games"] += len([g for g in
                                deployed.read_json(f"{season}/{group}/games.json")
                                if g.get("status") in ("completed", "forfeit")])
        totals["rows"] += rows
        totals["stats"] += stats
        totals["mismatches"] += mm
        totals["game_mismatches"] += gm
        all_disc.extend(disc)
        ok = "OK" if not mm and not gm else "MISMATCH"
        print(f"  group {group} {gname}: {rows} player-rows · {stats} stats compared · "
              f"{mm} stat + {gm} game mismatches [{ok}]", file=sys.stderr)

    print()
    print("=" * 72)
    print("VALIDATION SUMMARY")
    print("=" * 72)
    print(f"  games checked (completed/forfeit): {totals['games']}")
    print(f"  player-game rows compared:         {totals['rows']}")
    print(f"  stats compared (random sample):    {totals['stats']}")
    print(f"  stat mismatches:                   {totals['mismatches']}")
    print(f"  game-level mismatches:             {totals['game_mismatches']}")
    print(f"  player-row presence issues:        "
          f"{sum(1 for d in all_disc if d['type'].startswith('player_missing'))}")
    print(f"  source page parse failures:        "
          f"{sum(1 for d in all_disc if d['type'] == 'source_unparseable')}")

    if all_disc:
        print()
        print("DISCREPANCIES FOUND:")
        shown = 0
        for d in sorted(all_disc, key=lambda x: (x["type"], x["event"])):
            if shown >= 200:
                print(f"  … and {len(all_disc) - shown} more")
                break
            shown += 1
            loc = f"event {d['event']} (g{d['group']})"
            who = f" player {d.get('player_id')}" if "player_id" in d else ""
            print(f"  [{d['type']}] {loc}{who}: {d['detail']}")
        print()
        print(f"crosscheck: {len(all_disc)} discrepancy(ies) — see above.")
        return 1

    print()
    print("crosscheck: no discrepancies found — deployed data matches the source.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
