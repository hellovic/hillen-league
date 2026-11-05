#!/usr/bin/env python3
"""Replay identical source pages through two scraper versions, without HTTP.

The snapshot must come from a completed fresh scrape. Live runs are timed
separately; replay verifies policy request counts and exact output equality.
"""
import argparse
from contextlib import closing, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import scraper
from refresh_diff import dataset_digest


class Snapshot:
    def __init__(self, directory, age_hours):
        self.directory = Path(directory)
        self.age_seconds = age_hours * 3600
        self.responses = {}
        self.requests = 0
        self.body_bytes = 0
        self.urls = []

    def get(self, url, max_age=None):
        if url not in self.responses:
            path = self.directory / (re.sub(r"[^A-Za-z0-9_.-]", "_", url) + ".html")
            raw = path.read_bytes()
            self.responses[url] = raw.decode("utf-8")
            if max_age is None or self.age_seconds >= max_age:
                self.requests += 1
                self.body_bytes += len(raw)
                self.urls.append(url)
        return self.responses[url]


def replay(module, source_db, snapshot, age_hours, mutation=None):
    with tempfile.TemporaryDirectory() as directory:
        db = Path(directory) / "league.db"
        with closing(sqlite3.connect(source_db)) as src, closing(sqlite3.connect(db)) as dst:
            src.backup(dst)
        if mutation:
            with closing(sqlite3.connect(db)) as c:
                c.execute(*mutation)
                c.commit()
        cache = Snapshot(snapshot, age_hours)
        started = time.perf_counter()
        with redirect_stdout(io.StringIO()):
            module.refresh_database(str(db), module.ACTIVE_GROUPS, cache, incremental=True)
        elapsed = time.perf_counter() - started
        with closing(sqlite3.connect(db)) as c:
            digest = dataset_digest(c)
        return {"replay_seconds": elapsed, "planned_requests": cache.requests,
                "decoded_response_bytes": cache.body_bytes, "digest": digest,
                "urls": cache.urls}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before-script", required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--cache-age-hours", type=float, default=2)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("scraper_before", args.before_script)
    before = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(before)
    # Both versions run the real validator from the repository.
    before.__file__ = str(ROOT / "scraper.py")
    result = {"cache_age_hours": args.cache_age_hours,
              "before": replay(before, args.db, args.snapshot, args.cache_age_hours),
              "after": replay(scraper, args.db, args.snapshot, args.cache_age_hours)}
    result["identical_output"] = result["before"]["digest"] == result["after"]["digest"]
    # Simulate corrections while every detail cache is still fresh. A changed
    # leaderboard or advertised result must force the affected old score page.
    with closing(sqlite3.connect(args.db)) as c:
        row = c.execute("""SELECT g.event_id,g.season_id,g.group_id,l.category,l.rank
            FROM games g JOIN stat_leaderboards l
              ON l.season_id=g.season_id AND l.group_id=g.group_id
             AND l.team_id IN (g.home_team_id,g.away_team_id)
            WHERE g.season_id=32 AND g.status='completed' ORDER BY g.game_date LIMIT 1""").fetchone()
    if row:
        eid, season, group, category, rank = row
        url = f"{scraper.BASE}scores.php?season_id={season}&event_id={eid}"
        mutations = {
            "changed_score": ("UPDATE games SET home_score=home_score+1 WHERE event_id=?", (eid,)),
            "changed_leaderboard": ("UPDATE stat_leaderboards SET total=total+1 WHERE season_id=? AND group_id=? AND category=? AND rank=?", (season, group, category, rank)),
        }
        result["invalidation_checks"] = {}
        for name, mutation in mutations.items():
            case = replay(scraper, args.db, args.snapshot, 0, mutation)
            result["invalidation_checks"][name] = {
                "old_game_rechecked": url in case["urls"],
                "correct_output_restored": case["digest"] == result["after"]["digest"],
            }
    Path(args.report).write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v if k not in ("before", "after") else {x: y for x, y in v.items() if x != "urls"}
                      for k, v in result.items()}, indent=2))
    valid = result["identical_output"] and all(all(case.values()) for case in result.get("invalidation_checks", {}).values())
    return 0 if valid else 1


if __name__ == "__main__":
    sys.exit(main())
