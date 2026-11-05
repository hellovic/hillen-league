#!/usr/bin/env bash
#
# start.sh — ONE command to refresh all Hillen League data from the live site,
# validate it, rebuild the static site export, and push to GitHub.
#
# It also prints a "what changed" summary (new / updated / removed games) by
# snapshotting the database before the refresh and diffing it afterwards.
#
# Usage:
#   ./start.sh                       # full refresh + validate + export + commit + push
#   ./start.sh --no-refresh          # skip the site scrape (re-export + commit only)
#   ./start.sh --no-push             # refresh + validate + export + commit (no push)
#
# What it does:
#   1. snapshots the current games state (refresh_diff.py snapshot)
#   2. refreshes all active groups in one validated, incremental batch
#   3. promotes the staged database only after validation succeeds
#   4. prints the diff (new / updated / removed games) vs the snapshot
#   5. rebuilds the static docs/ export for GitHub Pages
#   6. appends a dated line (+ change summary) to CHANGELOG.md
#   7. commits everything and pushes to origin/main
#
# Safe to run repeatedly: skips the commit when nothing changed (e.g. a second
# run on the same day with no new site data).
set -euo pipefail
cd "$(dirname "$0")"

PUSH=1
REFRESH=1
SNAPSHOT=".refresh_snapshot.json"
for arg in "$@"; do
  case "$arg" in
    --no-push)    PUSH=0 ;;
    --no-refresh) REFRESH=0 ;;
    -h|--help)
      echo "Usage: $0 [--no-push] [--no-refresh]"
      echo "  --no-push     commit locally but do not push to GitHub"
      echo "  --no-refresh  skip the live-site scrape; only export/commit/push"
      exit 0 ;;
    *) echo "unknown option: $arg (see --help)"; exit 2 ;;
  esac
done

echo "==> Hillen League refresh $(date '+%Y-%m-%d %H:%M')"

# snapshot the current state so we can report what changed
if [ "$REFRESH" = "1" ]; then
  echo "==> snapshotting current games state"
  python3 refresh_diff.py snapshot "$SNAPSHOT" || echo "!! could not snapshot — continuing"
fi

# One staged, validated batch shares fresh season pages across all groups.
if [ "$REFRESH" = "1" ]; then
  RESULT=$(mktemp)
  trap 'rm -f "$RESULT"' EXIT
  python3 scraper.py --active --incremental --result-file "$RESULT"
  CONTENT_CHANGED=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["changed"]))' "$RESULT")
else
  echo "==> skipping scrape (--no-refresh)"
fi

# 2. validation gate
echo "==> validating database"
python3 validate.py || { echo "!! validation failed — not committing"; exit 1; }

# 4. compute the change summary (used both to decide whether to log/commit and
#    printed again at the very end so it's the last thing you see)
# The staged scraper preserves the database byte-for-byte on a no-op. Skip
# export and publication as well; unrelated working-tree changes are irrelevant.
if [ "$REFRESH" = "1" ] && [ "$CONTENT_CHANGED" = "0" ]; then
  echo "No league data changes — skipping build, commit and deployment."
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "changed=false" >> "$GITHUB_OUTPUT"; fi
  exit 0
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "changed=true" >> "$GITHUB_OUTPUT"; fi

echo "==> exporting static site to docs/"
python3 server.py --export docs
bash scripts/verify_export.sh docs

REFRESH_SUMMARY=""
if [ "$REFRESH" = "1" ]; then
  REFRESH_SUMMARY="$(python3 refresh_diff.py diff "$SNAPSHOT" --summary 2>/dev/null || true)"
fi
export REFRESH_SUMMARY

# 5. append a dated CHANGELOG line ONLY when the refresh actually changed data
python3 - <<'PYEOF'
import os, re, sqlite3, datetime
summary = os.environ.get("REFRESH_SUMMARY", "").strip()
# "X new, Y updated, Z removed, W unchanged" -> log only if something changed
changed = bool(summary)
for m in re.finditer(r"(\d+) (new|updated|removed)", summary):
    if int(m.group(1)) > 0:
        changed = True
if not changed:
    print("no data changes — skipping CHANGELOG")
    raise SystemExit(0)
db = sqlite3.connect("hillen_league.db")
games = db.execute("SELECT COUNT(*) FROM games").fetchone()[0]
box = db.execute("SELECT COUNT(*) FROM player_game_stats").fetchone()[0]
seasons = [str(r[0]) for r in db.execute("SELECT season_id FROM seasons ORDER BY season_id")]
tail = (" " + summary + ".") if summary and not str(summary).endswith(".") else ((" " + summary) if summary else "")
line = ("- Data refresh %s: %s games, %s box-score rows (seasons %s).%s"
        % (datetime.date.today().isoformat(), games, box, ", ".join(seasons), tail))
today = datetime.date.today().isoformat()
with open("CHANGELOG.md", encoding="utf-8") as f:
    text = f.read()
m = re.search(r"^(## \[[^\]]+\][^\n]*\n)", text, re.M)
if m and f"- Data refresh {today}" not in text:
    text = text[:m.end()] + line + "\n" + text[m.end():]
    with open("CHANGELOG.md", "w", encoding="utf-8") as f:
        f.write(text)
    print("CHANGELOG updated")
PYEOF

# 6. commit & push
if git diff --quiet -- hillen_league.db CHANGELOG.md && git diff --cached --quiet -- hillen_league.db CHANGELOG.md; then
  echo ""
  echo "No new data — nothing to commit."
  if [ "$REFRESH" = "1" ]; then
    echo ""
    python3 refresh_diff.py diff "$SNAPSHOT" || true
  fi
  exit 0
fi
# Explicit paths only: `git add -A` would also stage the untracked
# design/ screenshots and UX brief.
git add -- hillen_league.db CHANGELOG.md
git commit -m "Refresh data from live site ($(date +%Y-%m-%d))"
if [ "$PUSH" = "1" ]; then
  # HEAD:main works both locally (on main) and on GitHub Actions (detached HEAD)
  git push origin HEAD:main
  echo "Pushed to origin/main."
else
  echo "Committed locally (--no-push); push when ready."
fi
echo ""
echo "=== What changed in this refresh ==="
if [ "$REFRESH" = "1" ]; then
  python3 refresh_diff.py diff "$SNAPSHOT" || true
else
  echo "  (--no-refresh: no scrape, nothing new expected)"
fi
echo "Done."
