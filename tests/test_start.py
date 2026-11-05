"""Exercise shell orchestration without network, real git, builds or commits."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StartTests(unittest.TestCase):
    def test_unchanged_refresh_skips_build_and_all_git_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            shutil.copy2(ROOT / "start.sh", path / "start.sh")
            executable = path / "python3"
            executable.write_text(f"#!{sys.executable}\n" + '''import json, os, pathlib, sys
args = sys.argv[1:]
if args[0] == "-c":
    os.execv(sys.executable, [sys.executable] + args)
elif args[0] == "scraper.py":
    pathlib.Path(args[args.index("--result-file") + 1]).write_text(json.dumps({"changed": False}))
elif args[0] not in ("refresh_diff.py", "validate.py"):
    raise SystemExit("An unchanged refresh tried to build or publish")
''')
            executable.chmod(0o755)
            git = path / "git"
            git.write_text("#!/bin/sh\necho 'Unexpected git operation' >&2\nexit 99\n")
            git.chmod(0o755)
            output = path / "outputs"
            env = {**os.environ, "PATH": str(path) + os.pathsep + os.environ["PATH"],
                   "GITHUB_OUTPUT": str(output)}
            result = subprocess.run(["bash", str(path / "start.sh")], env=env, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertEqual("changed=false\n", output.read_text())
            self.assertIn("skipping build, commit and deployment", result.stdout)


if __name__ == "__main__":
    unittest.main()
