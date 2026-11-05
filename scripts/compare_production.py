#!/usr/bin/env python3
"""Compare a downloaded live production bundle with a local database, offline."""
import argparse
import copy
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import scraper
from crosscheck import STAT_FIELDS
from benchmark_scraper import Snapshot


def verify_source_metadata(connection, directory):
    source = Snapshot(directory, 0)
    checks = {"rosters": 0, "profiles": 0, "registration_groups": 0, "leaderboard_groups": 0, "standings_groups": 0, "differences": []}
    for season, group in scraper.ACTIVE_GROUPS:
        name = connection.execute("SELECT name FROM groups WHERE season_id=? AND group_id=?", (season, group)).fetchone()[0]
        div = source.get(f"{scraper.BASE}division.php?season_id={season}&group_id={group}")
        expected_teams = {tid for tid, _ in scraper.parse_division_teams(div)}
        actual_teams = {r[0] for r in connection.execute("SELECT team_id FROM season_teams WHERE season_id=? AND group_id=?", (season, group))}
        if actual_teams != expected_teams:
            checks["differences"].append(f"{season}/{group}/registrations")
        checks["registration_groups"] += 1
        raw = source.get(f"{scraper.BASE}statistics.php?season_id={season}&group_id={group}")
        boards = scraper.parse_leaderboards(raw)
        expected = {(r["category"], r["rank"], r["player_id"], r["team_id"], r["games"], r["total"], r["avg"]) for r in boards}
        actual = {tuple(r) for r in connection.execute("SELECT category,rank,player_id,team_id,games_played,total,avg FROM stat_leaderboards WHERE season_id=? AND group_id=?", (season, group))}
        if actual != expected:
            checks["differences"].append(f"{season}/{group}/leaders")
        checks["leaderboard_groups"] += 1
        standings = scraper.parse_standings(source.get(f"{scraper.BASE}division.php?season_id={season}"), name)
        columns = ("team_id", "rank", "gp", "wins", "losses", "forfeits", "diff", "points")
        expected = {tuple(r[k] for k in columns) for r in standings}
        actual = {tuple(r) for r in connection.execute("SELECT team_id,rank,gp,wins,losses,forfeits,diff,points FROM standings WHERE season_id=? AND group_id=?", (season, group))}
        if actual != expected:
            checks["differences"].append(f"{season}/{group}/standings")
        checks["standings_groups"] += 1
        for (tid,) in connection.execute("SELECT team_id FROM season_teams WHERE season_id=? AND group_id=?", (season, group)):
            html = source.get(f"{scraper.BASE}teams_detail_info.php?season_id={season}&team_id={tid}")
            profile, roster, _ = scraper.parse_team_page(html, season, tid)
            expected = {(r["player_id"], r["jersey_no"]) for r in roster}
            actual = {tuple(r) for r in connection.execute("SELECT player_id,jersey_no FROM rosters WHERE season_id=? AND team_id=?", (season, tid))}
            if actual != expected:
                checks["differences"].append(f"{season}/{group}/teams/{tid}/roster")
            checks["rosters"] += 1
            fields = ("manager", "captain_player_id", "home_color", "away_color", "season_pts_for", "season_pts_against")
            actual = connection.execute("SELECT " + ",".join(fields) + " FROM season_teams WHERE season_id=? AND team_id=?", (season, tid)).fetchone()
            if tuple(actual) != tuple(profile.get(k) for k in fields):
                checks["differences"].append(f"{season}/{group}/teams/{tid}/profile")
            checks["profiles"] += 1
    checks["all_equal"] = not checks["differences"]
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--production-bundle", required=True)
    parser.add_argument("--db", default=server.DB_PATH)
    parser.add_argument("--report", required=True)
    parser.add_argument("--source-cache", help="audit changed metadata against the captured fresh source responses; no network")
    args = parser.parse_args()
    text = Path(args.production_bundle).read_text()
    production = json.loads(text.split("window.LEAGUE_DATA", 1)[1].split("=", 1)[1].strip().rstrip(";"))
    with closing(sqlite3.connect(args.db)) as c:
        c.row_factory = sqlite3.Row
        local = server.build_league_bundle(c, args.db)
        source_check = verify_source_metadata(c, args.source_cache) if args.source_cache else None
    result = {"production_refreshed_at": production["meta"]["refreshed_at"],
              "local_refreshed_at": local["meta"]["refreshed_at"],
              "counts_equal": production["meta"]["counts"] == local["meta"]["counts"],
              "counts": local["meta"]["counts"], "detail_payloads": {},
              "missing_keys": sorted(production.keys() - local.keys()),
              "new_keys": sorted(local.keys() - production.keys()),
              "detail_differences": [], "list_differences": [],
              "other_differences": [], "player_game_rows": 0, "stat_values": 0,
              "source_metadata": source_check, "changed_team_fields": {}}
    for key in sorted(production.keys() & local.keys()):
        parts = key.split("/")
        if len(parts) == 4 and parts[2] in ("games", "players", "teams"):
            kind = parts[2]
            result["detail_payloads"][kind] = result["detail_payloads"].get(kind, 0) + 1
            if production[key] != local[key]:
                result["detail_differences"].append(key)
                if kind == "teams":
                    result["changed_team_fields"][key] = [f for f in production[key] if production[key][f] != local[key].get(f)]
            if kind == "games":
                result["player_game_rows"] += len(local[key]["box"])
                result["stat_values"] += len(local[key]["box"]) * len(STAT_FIELDS)
        elif len(parts) == 3 and parts[2] in ("games", "players", "teams", "leaders"):
            if production[key] != local[key]:
                result["list_differences"].append(key)
        elif production[key] != local[key]:
            result["other_differences"].append(key)
    result["all_entity_data_equal"] = not (result["detail_differences"] or result["list_differences"]
                                            or result["missing_keys"] or result["new_keys"])
    # Derived summaries intentionally count awarded forfeits as results. Any
    # other difference must be backed by the independently parsed source table.
    unexplained = []
    for key in result["other_differences"]:
        if key == "meta":
            expected = {**production[key], "refreshed_at": local[key]["refreshed_at"]}
        elif key.startswith("season/"):
            season = int(key.split("/")[1])
            expected = copy.deepcopy(production[key])
            games = [v for k, v in local.items() if k.startswith(f"{season}/") and "/games/" in k]
            expected["totals"]["played"] += sum(g["status"] == "forfeit" for g in games)
            actual_groups = {g["group_id"]: g for g in local[key]["groups"]}
            for group in expected["groups"]:
                gid = group["group_id"]
                group["played"] += sum(g["status"] == "forfeit" and g["group_id"] == gid for g in games)
                standings_key = f"{season}/{gid}/standings"
                if source_check and source_check["all_equal"] and production.get(standings_key) != local.get(standings_key):
                    group["leader"] = actual_groups[gid]["leader"]
        elif key.endswith("/standings") and source_check and source_check["all_equal"]:
            if tuple(map(int, key.split("/")[:2])) not in scraper.ACTIVE_GROUPS:
                unexplained.append(key)
            continue
        else:
            unexplained.append(key)
            continue
        if expected != local[key]:
            unexplained.append(key)
    result["unexplained_derived_differences"] = unexplained
    core_equal = not any("/games/" in k or "/players/" in k for k in result["detail_differences"])
    metadata_explained = (source_check and source_check["all_equal"]
                          and all(fields == ["roster"] for fields in result["changed_team_fields"].values())
                          and all(k.endswith("/leaders") for k in result["list_differences"]))
    result["game_and_player_details_equal"] = core_equal
    result["verified_output"] = (result["counts_equal"] and core_equal
                                  and not result["missing_keys"] and not result["new_keys"]
                                  and not unexplained
                                  and (result["all_entity_data_equal"] or bool(metadata_explained)))
    Path(args.report).write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return 0 if result["verified_output"] else 1


if __name__ == "__main__":
    sys.exit(main())
