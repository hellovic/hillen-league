# Hillen League Database

SQLite database of Hillen Youth League (驍籃青少年籃球聯賽) data, scraped from
https://www.hillen-sports.com/hillenyouth/ for analysis.

**Current contents:** Season 32 (第三十二屆驍籃青少年籃球聯賽), three groups —
**YOUTH GIRLS U13** (group 26), **YOUTH GIRLS U11A** (group 28), **YOUTH GIRLS U11B**
(group 31): 18 teams, 28 scheduled games (25 played, 1 forfeit, 2 not played),
227 players, 612 player-game box-score rows.

The schema and scraper are parameterised, so other groups/seasons can be added with one command.

## Files

| File | Purpose |
|---|---|
| `hillen_league.db` | The SQLite database (this is what you query) |
| `schema.sql` | Full schema: tables, indexes, analysis views |
| `scraper.py` | Stdlib-only scraper (urllib + re + sqlite3) that builds the DB |
| `server.py` | Stdlib-only dashboard server: static files + read-only JSON API |
| `dashboard/` | The dashboard frontend (vanilla HTML/CSS/JS, no build step) |
| `cache/` | Raw HTML snapshots so re-runs are fast and idempotent |

## Dashboard (web UI)

A zero-dependency web dashboard over the database — standings, teams (+ rosters,
results, leaders), players (sortable season stats, game logs) and games (full
box scores with quarter-by-quarter and per-player stats).

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

## Publish to GitHub Pages (free, public URL)

The dashboard also runs as a **pure static site** — the same frontend falls back to
pre-exported JSON under `docs/` when no `/api` is available, so it works on any
static host. GitHub Pages is free and gives a permanent URL.

```bash
# 1. regenerate the static site whenever the DB changes
python3 server.py --export docs

# 2. commit & push (repo already initialised)
git add docs
git commit -m "update stats"
git push
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
| `groups` | `group_id` | e.g. 26 = YOUTH GIRLS U13 |
| `teams` | `team_id` | Team (name = latest known) |
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
```

The pipeline: division page → teams & standings → statistics page → 8 leaderboards →
season schedule → per-team pages (profile, roster, schedule) → per-game `scores.php`
box scores. All inserts are upserts, so re-runs are safe and idempotent.

## Notes & caveats

- **Not-played games**: a scheduled game with no box score (e.g. event 19126, GTG
  walkover) is stored with `status = 'not_played'` and `NULL` scores, so it is
  excluded from standings/statistics views. GTG therefore shows 0 GP.
- **Forfeit games**: a default-score result where nobody logged minutes (e.g.
  event 19954, Dreams Team 20-0 Blaze Phoenix) is stored with `status = 'forfeit'`.
  The official 分組表 counts it as a win for the higher-scoring team and 棄
  (forfeit) for the loser (Blaze: 0W 2L 1棄), and `v_team_season_totals` reproduces
  that: `GP = wins + losses + forfeits`.
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
