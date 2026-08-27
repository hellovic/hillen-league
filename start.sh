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
#   2. re-scrapes every configured (season, group) with --refresh (bypasses cache)
#   3. runs validate.py — aborts WITHOUT committing if any check fails
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

# 1. refresh every girls group in both seasons from the live site
if [ "$REFRESH" = "1" ]; then
  for s in 32 31; do
    case "$s" in
      32) GROUPS="26 27 28 30 31" ;;
      31) GROUPS="25 26 27 28 29" ;;
    esac
    for g in $GROUPS; do
      echo "==> scraping season $s group $g (--refresh)"
      python3 scraper.py --season "$s" --group "$g" --refresh \
        || { echo "!! scrape failed for s${s} g${g} — aborting"; exit 1; }
    done
  done
else
  echo "==> skipping scrape (--no-refresh)"
fi

# 2. validation gate
echo "==> validating database"
python3 validate.py || { echo "!! validation failed — not committing"; exit 1; }

# 3. rebuild the static export (GitHub Pages)
echo "==> exporting static site to docs/"
python3 server.py --export docs

# 4. compute the change summary (used both to decide whether to log/commit and
#    printed again at the very end so it's the last thing you see)
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
changed = False
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
if git diff --quiet && git diff --cached --quiet; then
  echo ""
  echo "No new data — nothing to commit."
  if [ "$REFRESH" = "1" ]; then
    echo ""
    python3 refresh_diff.py diff "$SNAPSHOT" || true
  fi
  exit 0
fi
git add -A
git commit -m "Refresh data from live site ($(date +%Y-%m-%d))"
if [ "$PUSH" = "1" ]; then
  git push origin main
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
