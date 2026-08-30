# Hillen League Database

SQLite database of Hillen Youth League (驍籃青少年籃球聯賽) data, scraped from
https://www.hillen-sports.com/hillenyouth/ for analysis.

**Current contents:** Two seasons of **Youth Girls** data.

* **Season 32** (第三十二屆驍籃青少年籃球聯賽): U9 (27), U11A (28), U11B (31),
  U13 (26), U15 (30) — 27 teams, 40 games.
* **Season 31** (第三十一屆驍籃青少年籃球聯賽): YOUTH GIRL U9 (25), U11 GROUP A (26),
  U11 GROUP B (27), U13 (28), U15 (29) — 25 teams, 71 games.

Combined: 45 teams, 615 players, 111 games, 2,831 player-game box-score rows.

The schema and scraper are parameterised, so other groups/seasons can be added with one command.

## Files

| File | Purpose |
|---|---|
| `hillen_league.db` | The SQLite database (this is what you query) |
| `schema.sql` | Full schema: tables, indexes, analysis views |
| `scraper.py` | Stdlib-only scraper (urllib + re + sqlite3) that builds the DB |
| `start.sh` | **One command** to refresh all data from the live site, validate, rebuild the static export, and push to GitHub — run regularly / manually. Prints a *what changed* summary (new/updated/removed games) |
| `refresh_diff.py` | Snapshot/diff helper used by `start.sh`: captures the games state before a refresh and reports what it changed afterwards |
| `server.py` | Stdlib-only dashboard server: static files + read-only JSON API |
| `dashboard/` | The dashboard frontend (vanilla HTML/CSS/JS, no build step) |
| `validate.py` | Data validation suite (box-score/standings reconciliation) |
| `crosscheck.py` | **Deployed-vs-source validator**: samples 10 random stats per game per player from the deployed site and compares them against hillen-sports.com |
| `.github/workflows/refresh.yml` | GitHub Actions **scheduled refresh**: runs `./start.sh` in the cloud on a cron and pushes the result (auto rebuilds Pages) |
| `cache/` | Raw HTML snapshots so re-runs are fast and idempotent |

## Dashboard (web UI)

A zero-dependency web dashboard over the database:

- **Standings** — official group table + points for/against bars
- **Teams** — rosters, season leaders, results, and a points-for/against trend chart
- **Players** — sortable/searchable season stats (incl. +/-), **shooting efficiency (eFG%, TS%)**, per-game points chart, radar vs group average, full game logs
- **Games** — box scores, scoring-by-quarter table, team performance, full per-player lines
- **Leaders** — the league's own top-5 leaderboards per category (MVP, 得分王, 三分王, 助攻王, 偷截王, 罰球王, 籃板王, 封阻王), with CSV
- **Compare** — pick two players or two teams: side-by-side stats (better value highlighted), radar, per-game charts, and head-to-head meetings with series record (shareable URL `#/compare/p/<idA>/<idB>`)
- **Global search** — header box that matches players, teams, and games **across all seasons/groups** and jumps to the page
- **Light/dark theme toggle** (persisted), and a footer **data-through** date
- **CSV export** — a ⬇ CSV button on every table (standings, teams, players, games, box scores, game logs, rosters, leaders); Excel-friendly (UTF-8 BOM)
- Mobile-friendly, age-group-sorted group switcher, live API mode locally / static mode on GitHub Pages

```bash
python3 server.py            # default port 8000
# open http://127.0.0.1:8000
```

Optional: `python3 server.py --port 9000 --db path/to/hillen_league.db`

The frontend talks to a read-only JSON API:

| Endpoint | Returns |
|---|---|
| `/api/meta` | seasons, groups, row counts |
| `/api/standings?season=&group=` | official group table |
| `/api/teams?season=&group=` | teams with season record |
| `/api/teams/<team_id>?season=` | profile, roster, results, leaders |
| `/api/players?season=&group=` | all players with season totals/averages |
| `/api/players/<player_id>?season=` | totals + per-game log |
| `/api/games?season=&group=` | all games with scores |
| `/api/games/<event_id>` | quarters, team stats, full box scores |
| `/api/leaders?season=&group=` | league top-5 per category (MVP, pts, 3p, ast, stl, ft, reb, blk) |

## Publish to GitHub Pages (free, public URL)

The dashboard also runs as a **pure static site** — the same frontend falls back to
pre-exported JSON under `docs/` when no `/api` is available, so it works on any
static host. GitHub Pages is free and gives a permanent URL.

**Deploy only when asked**: normal work (edits, fixes, new features) is committed
locally with descriptive notes; the static export (`docs/`) and the push to
GitHub happen only when a deployment is requested.

```bash
# ---- normal development: commit locally, do NOT push ----
git add -A
git commit -m "describe the change"

# ---- deploy (only when requested): regenerate, commit, push ----
python3 server.py --export docs     # rebuild static site into docs/
git add docs
git commit -m "deploy: <what changed>"
git push                            # GitHub Pages auto-rebuilds (~1 min)
```

Setup once:

1. Create a **public** repo at https://github.com/new named `hillen-league` (no files).
2. Push this project:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/hillen-league.git
   git branch -M main
   git push -u origin main
   ```
3. GitHub → repo → **Settings → Pages** → *Source: Deploy from a branch*,
   branch `main`, folder **`/docs`** → Save (GitHub's folder list only offers `/` or `/docs`)
4. Done — the dashboard is live at
   `https://<YOUR_USERNAME>.github.io/hillen-league/`

Alternative static hosts (same `docs/` folder, no code changes): drag `docs/` into
[Netlify Drop](https://app.netlify.com/drop) for an instant URL, or upload to
Cloudflare Pages / Vercel.

## Schema overview

Reference entities:

| Table | Key | Notes |
|---|---|---|
| `seasons` | `season_id` | e.g. 32 = 第三十二屆驍籃青少年籃球聯賽 |
| `groups` | `(season_id, group_id)` | **Season-scoped**: the site reuses group ids across seasons with different meanings (26 = YOUTH GIRLS U13 in s32, but YOUTH GIRL U11 GROUP A in s31) |
| `teams` | `team_id` | Team (name = latest known; ids are stable across seasons) |
| `players` | `player_id` | Player (global id, name) |

Season-scoped data:

| Table | Key | Notes |
|---|---|---|
| `season_teams` | `(season_id, team_id)` | Group enrollment + manager, captain, home/away colours, season pts for/against |
| `rosters` | `(season_id, team_id, player_id)` | Jersey numbers |
| `standings` | `(season_id, group_id, team_id)` | Official 分組表: rank, GP, W/L, forfeits, +/- , points |
| `games` | `event_id` | Date/time, venue, home/away teams, final score, status (`completed` / `forfeit` / `not_played` / `scheduled`) |
| `game_quarters` | `(event_id, team_id)` | Q1–Q4 + OT per team |
| `game_team_stats` | `(event_id, team_id)` | Team turnovers, rebounds, fast-break points, shirt colour |
| `player_game_stats` | `(event_id, player_id)` | Full per-player box score (see below) |
| `stat_leaderboards` | `(season_id, group_id, category, rank)` | Top-N per category from statistics.php: `mvp, pts, fg3, ast, stl, ft, reb, blk` |

`player_game_stats` columns (per game, per player): `minutes`, `fg2m/fg2a/fg2_pct`,
`fg3m/fg3a/fg3_pct`, `fgm/fga/fg_pct`, `ftm/fta/ft_pct`, `off_reb`, `def_reb`, `tot_reb`,
`ast`, `stl`, `blk`, `fb` (fast-break), `ba` (blocked-against), `tov`, `pf`, `eff`,
`plus_minus`, `pts`, `jersey_no`.

## Analysis views (already in the DB)

| View | Contents |
|---|---|
| `v_played_games` | Box-score rows with minutes > 0 (excludes DNP bench entries) |
| `v_player_season_totals` | Per-player season totals (GP, minutes, all box-score sums) — only games actually played |
| `v_player_season_averages` | Same + per-game averages (pts/g, ast/g, reb/g, stl/g, blk/g, eff/g) |
| `v_team_season_totals` | Per-team season record incl. forfeits + pts for/against (recomputes the official 分組表 from games) |

## Example queries

```sql
-- Season scoring leaders (Girl U13)
SELECT player_name, team_name, gp, pts, ROUND(pts*1.0/gp, 1) AS ppg
FROM v_player_season_totals WHERE season_id = 32
ORDER BY pts DESC;

-- Team standings recomputed from games (matches official table)
SELECT * FROM v_team_season_totals WHERE season_id = 32;

-- Every game with results
SELECT g.game_date, ht.name AS home, g.home_score, g.away_score, at.name AS away, g.venue
FROM games g
JOIN teams ht ON ht.team_id = g.home_team_id
JOIN teams at ON at.team_id = g.away_team_id
WHERE g.status = 'completed' ORDER BY g.game_date;

-- A player's game log
SELECT g.game_date, v.name AS opponent, pgs.pts, pgs.tot_reb, pgs.ast, pgs.stl, pgs.eff
FROM player_game_stats pgs
JOIN games g ON g.event_id = pgs.event_id
JOIN teams v  ON v.team_id = CASE WHEN g.home_team_id = pgs.team_id
                                  THEN g.away_team_id ELSE g.home_team_id END
WHERE pgs.player_id = 15379 ORDER BY g.game_date;
```

## Re-scraping / adding more data

```bash
# Re-run for the current group (uses cache; add --refresh to hit the site again)
python3 scraper.py

# Add another group in the same season, e.g. YOUTH GIRLS U15 (group 30)
python3 scraper.py --group 30

# Add another season (season id shown in team-page URLs, e.g. season_id=31)
python3 scraper.py --season 31 --group 26

# Verify the database is consistent (exit 0 = all good)
python3 validate.py
```

The pipeline: division page → teams & standings → statistics page → 8 leaderboards →
season schedule → per-team pages (profile, roster, schedule) → per-game `scores.php`
box scores. All inserts are upserts, so re-runs are safe and idempotent.

## Scheduled refresh (GitHub Actions)

A **GitHub Actions workflow** (`.github/workflows/refresh.yml`) runs the same
`./start.sh` in GitHub's cloud on a schedule, so your Mac doesn't need to be on.
It refreshes the data, validates it, rebuilds `docs/`, commits the result, and
pushes back to `main` (which auto-rebuilds GitHub Pages).

* Default (Hong Kong time): **every day 06:00, plus Sat & Sun 12:00 / 15:00 /
  21:00** — edit the `cron` in the file (cron is UTC; must be pushed to `main`
  to take effect).
* Runs in GitHub's cloud on **Hong Kong time** (the cron entries are converted
  from HK to UTC).
* Also triggerable **manually** from the repo's **Actions** tab → *Daily data
  refresh* → *Run workflow*.
* The commit is authored by "Hillen League Bot" (`actions@users.noreply.github.com`).
* If validation fails, the workflow aborts before committing — it will not push
  broken data.
* Free-tier note: cloud runners use GitHub Actions minutes (public repos = free;
  private repos = a 2,000 min/month allowance). One run is a few minutes.

Prefer to keep it on your own machine instead? Run `./start.sh` via cron/launchd
(needs your Mac to be awake at the scheduled time).

## Data validation (`validate.py`)

Run after any scrape to verify the database:

| Check | What it verifies |
|---|---|
| Box-score sums | Per-team PTS totals equal official game scores (every completed game) |
| Quarter sums | Q1–OT totals equal final scores |
| Standings | Computed team records (`v_team_season_totals`) match the official 分組表 |
| Forfeit games | All box rows are DNP (0:00); scores present |
| Not-played games | No box rows; NULL scores |
| DNP rule | Season stats count exactly the games with minutes > 0 |
| Referential integrity | No orphan rows across games/players/teams/rosters |

Exits non-zero on any failure. Full recommended refresh flow:

```bash
python3 scraper.py --group 30      # scrape new data
python3 validate.py                # verify (must exit 0)
python3 server.py --export docs    # regenerate static site
git add -A && git commit -m "update stats" && git push   # auto-deploys
```

## Cross-checking the deployed site against the source (`crosscheck.py`)

Verifies the **published dashboard** (https://hellovic.github.io/hillen-league/)
against the **source of truth** (https://www.hillen-sports.com/hillenyouth/).
For **every game, every player**, it randomly samples 10 per-player box-score
stats from the deployed JSON and compares each value with the same stat parsed
live from the source `scores.php` page.

```bash
python3 crosscheck.py                   # deployed site vs LIVE source pages
python3 crosscheck.py --use-cache       # vs cached source snapshots (offline/fast)
python3 crosscheck.py --local-docs      # read deployed JSON from ./docs instead
python3 crosscheck.py --sample 10 --seed 42   # tune sample size / RNG seed
python3 crosscheck.py --group 26        # restrict to one group
```

What it reports:

- Per group: player-rows compared, stats compared, stat + game mismatches
- Overall summary: games, rows, stats sampled, mismatches, presence issues
- A detail line for **every discrepancy**: event, group, player, field, and the
  deployed vs source values — including players missing on either side, final
  score differences, and source pages that failed to parse

Exit codes: `0` = all compared stats match, `1` = discrepancies found,
`2` = operational failure (network/parse) so the comparison is incomplete.
Sampling is seeded (default `42`) for reproducible runs; `--seed random` for a
fresh draw each run.

## Notes & caveats

- **Not-played games**: a game recorded with a 0-0 result (e.g. event 19126, GTG
  walkover; several s31 voids) is stored with `status = 'not_played'` and `NULL`
  scores — the site's standings don't count these at all, and they are excluded
  from all stats views. GTG therefore shows 0 GP.
- **Forfeit games**: a default-score result where nobody logged minutes (e.g.
  event 19954, Dreams Team 20-0 Blaze Phoenix) is stored with `status = 'forfeit'`.
  The official 分組表 counts it as a win for the higher-scoring team and 棄
  (forfeit) for the loser (Blaze: 0W 2L 1棄), and `v_team_season_totals` reproduces
  that: `GP = wins + losses + forfeits`.
- **Season-31 standings are frozen first-leg snapshots**: the site's s31 分組表
  pages were never updated after the first round of fixtures, even though most
  groups played second-leg (home/away) games afterwards. The `games` table
  contains the full schedule (e.g. s31 U9: 15 games), while `standings` records
  the official first-leg table (GP=4 per team) — so `v_team_season_totals`
  (recomputed from all games) will differ from the s31 `standings` for those
  groups. Cross-group U11 playoff games ("YOUTH GIRL U11 DIVISION 1/2") are
  recorded on the site but belong to no group; they are intentionally not scraped.
- **Did-not-play (DNP) rows**: box scores list bench players with `0:00` minutes.
  These rows are kept in `player_game_stats` (so game box scores stay complete,
  and are shown as "DNP" on the game page) but are **excluded from all player
  season stats and game logs** — a game counts toward a player's GP only if they
  actually played (minutes > 0). This matches the league's own statistics
  (e.g. 石文嫣's DNP game vs Pusion is not counted: GP 3 → 2).
- **SSL**: the site omits its intermediate certificate; the scraper downloads the
  GoDaddy G2 intermediate once into `cache/` to verify the chain (falls back to
  unverified for this read-only public data if that fails).
- **Leaderboards** (`stat_leaderboards`) are the site's own top-5 per category;
  full per-player season stats are derivable from `v_player_season_*`.
- Team `name` in `teams` is the latest scraped name; per-season naming differences
  (e.g. "YOUTH GIRL U13" vs "YOUTH GIRLS U13") are recorded via `groups` per scrape.
