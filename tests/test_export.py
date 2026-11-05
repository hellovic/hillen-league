import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


class ExportTests(unittest.TestCase):
    def test_split_files_preserve_every_payload_and_version_independently(self):
        bundle = {
            "meta": {"refreshed_at": "2026-11-04 13:51:44"},
            "season/33": {"season_id": 33},
            "33/16/players": [{"player_id": 15202}],
            "33/16/players/15202": {"pts": 28},
            "32/26/players/15202": {"pts": 100},
        }
        with tempfile.TemporaryDirectory() as directory:
            server.write_split_data(directory, bundle)
            text = Path(directory, "league-bootstrap.js").read_text()
            bootstrap = json.loads(text.split("window.LEAGUE_DATA = ")[1].rstrip(";\n"))
            self.assertNotIn("33/16/players/15202", bootstrap)
            manifest = bootstrap["__detail_files"]
            for key, url in manifest.items():
                payload = json.loads(Path(directory, url.split("?")[0]).read_text())
                self.assertEqual(bundle[key], payload[key])
            previous = manifest.copy()
            bundle["33/16/players/15202"]["pts"] = 29
            server.write_split_data(directory, bundle)
            text = Path(directory, "league-bootstrap.js").read_text()
            updated = json.loads(text.split("window.LEAGUE_DATA = ")[1].rstrip(";\n"))["__detail_files"]
            self.assertNotEqual(previous["33/16/players/15202"], updated["33/16/players/15202"])
            self.assertEqual(previous["32/26/players/15202"], updated["32/26/players/15202"])

    def test_data_change_does_not_invalidate_app_or_styles(self):
        def fake_build(directory):
            path = Path(directory)
            (path / "assets").mkdir()
            (path / "assets/index.js").write_text("app")
            (path / "assets/index.css").write_text("styles")
            (path / "index.html").write_text('<script src="./assets/index.js"></script><link href="./assets/index.css"><script src="/league-bootstrap.js"></script>')
        with tempfile.TemporaryDirectory() as directory, patch.object(server, "build_react_dashboard", fake_build):
            # Use a separate database copy so no test can touch the source DB.
            import sqlite3
            from contextlib import closing
            db = str(Path(directory) / "league.db")
            with closing(sqlite3.connect(ROOT / "hillen_league.db")) as src, closing(sqlite3.connect(db)) as dst:
                src.backup(dst)
            output = str(Path(directory) / "site")
            server.export_static(output, db)
            before = Path(output, "index.html").read_text()
            with closing(sqlite3.connect(db)) as c:
                c.execute("UPDATE refresh_meta SET value='2026-11-05 08:05:00'")
                c.commit()
            server.export_static(output, db)
            after = Path(output, "index.html").read_text()
            import re
            assets = lambda text: re.findall(r'assets/[^"<>]+', text)
            self.assertEqual(assets(before), assets(after))
            self.assertNotEqual(before, after)


if __name__ == "__main__":
    unittest.main()
