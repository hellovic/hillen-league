import json
import tempfile
import unittest
from pathlib import Path

from server import build_player_stories, write_split_data


class PlayerStoryTests(unittest.TestCase):
    def test_normalized_ids_share_a_career_and_only_positive_minutes_count(self):
        teams = {10: "Club", 20: "School", 30: "Select"}
        names = {1: " Ａda ", 2: "Ada", 3: "Mina", 4: "Mina", 5: "Reserve"}
        bundle = {"meta": {
            "combos": [{"season": 31, "group": 10}, {"season": 32, "group": 10}],
            "groups": [
                {"season_id": 31, "group_id": 10, "name": "Girls U11"},
                {"season_id": 32, "group_id": 10, "name": "Boys U11"},
            ],
        }}
        for season, rosters in ((31, {10: [1, 3], 20: [2, 4]}), (32, {30: [2, 5]})):
            prefix = f"{season}/10"
            bundle[f"{prefix}/teams"] = [{"team_id": team, "team_name": teams[team]} for team in rosters]
            bundle[f"{prefix}/games"] = []
            for team, ids in rosters.items():
                bundle[f"{prefix}/teams/{team}"] = {"roster": [
                    {"player_id": pid, "player_name": names[pid], "jersey_no": pid} for pid in ids
                ]}

        def game(event, season, status, home, away, players):
            prefix = f"{season}/10"
            box = []
            for pid, team, minutes, pts in players:
                row = dict.fromkeys(("tot_reb", "ast", "stl", "blk", "fgm", "fga", "fg2m", "fg2a",
                                     "fg3m", "fg3a", "ftm", "fta"), 0)
                row.update(player_id=pid, player_name=names[pid], jersey_no=pid, team_id=team,
                           minutes=minutes, pts=pts, eff=pts)
                box.append(row)
            bundle[f"{prefix}/games"].append({"event_id": event})
            bundle[f"{prefix}/games/{event}"] = dict(
                event_id=event, season_id=season, group_id=10, status=status,
                game_date="2026-01-01", start_time="02:00 PM" if event == 1 else "10:00 AM", venue="Court",
                home_team_id=home, home_name=teams[home], away_name=teams[away], home_score=40,
                away_score=32, box=box,
            )

        game(1, 31, "completed", 10, 20, [(1, 10, "05:11", 8), (2, 10, "04:10", 6),
                                          (3, 10, "01:00", 2), (4, 20, "04:00", 4)])
        game(2, 31, "completed", 20, 10, [(2, 20, "00:09", 3)])
        game(3, 32, "forfeit", 30, 10, [(2, 30, "12:00", 18)])
        game(4, 32, "completed", 30, 10, [(2, 30, "00:00", 25), (5, 30, None, 5)])

        catalog, buckets = build_player_stories(bundle)
        story = buckets[1][1]
        self.assertEqual(story, buckets[2][2])
        self.assertEqual({"seasons": 2, "teams": 2, "games": 2, "points": 11}, story["totals"])
        self.assertEqual(2, story["first"]["event_id"])
        self.assertEqual(8, story["best"]["pts"]["pts"])
        self.assertEqual(0, story["chapters"][1]["teams"][0]["gp"])
        self.assertFalse(buckets[5][5]["best"])
        self.assertTrue(buckets[3][3]["identity_conflict"])
        self.assertEqual([4], buckets[4][4]["ids"])
        self.assertEqual({1, 3, 4}, {entry["id"] for entry in catalog["girls"]})
        self.assertEqual({1, 5}, {entry["id"] for entry in catalog["boys"]})
        ada_girls = next(entry for entry in catalog["girls"] if entry["id"] == 1)
        ada_boys = next(entry for entry in catalog["boys"] if entry["id"] == 1)
        self.assertEqual(("Club", 2), (ada_girls["team"], ada_girls["games"]))
        self.assertEqual(("Select", 0), (ada_boys["team"], ada_boys["games"]))

        with tempfile.TemporaryDirectory() as directory:
            write_split_data(directory, bundle, (catalog, buckets))
            bootstrap = Path(directory, "league-bootstrap-lite.js").read_text()
            spotlights = json.loads(bootstrap.split("window.LEAGUE_DATA = ", 1)[1].rstrip(";\n"))["__story_spotlights"]
        self.assertEqual({1, 3, 4}, {entry["ids"][0] for entry in spotlights})
        ada = next(entry for entry in spotlights if entry["ids"] == [1, 2])
        self.assertEqual((11, 2), (ada["points"], ada["games"]))
