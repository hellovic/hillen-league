# Changelog

All notable changes to the Hillen League database, scraper, and dashboard.
Format follows deployed versions; each entry lists the user-visible changes.

## [v5.0] — Unreleased — Multi-season support (Season 31)
- Data refresh 2026-08-27: 112 games, 2831 box-score rows (seasons 31, 32). 0 new, 0 updated, 0 removed, 112 unchanged.
- Data refresh 2026-08-23: 112 games, 2831 box-score rows (seasons 31, 32).
- **Season 31** (第三十一屆驍籃青少年籃球聯賽) added for all five Youth Girls
  groups: YOUTH GIRL U9 (25), U11 GROUP A (26), U11 GROUP B (27), U13 (28),
  U15 (29) — 25 teams, 71 games. Combined with season 32: 45 teams, 112 games,
  615 players, 2,831 box-score rows.
- Data refreshed from the live site (2026-08-22): season-32 gains the played
  U11A game 20600 (聖博德(G) u11(A) 19-26 Blaze Phoenix) and a newly scheduled
  U11B game 20652 (2026-08-23); the 2026-08-16 U11B game 20624 (可立U11 vs
  青出於籃U11) is recorded as a 0-0 not-played void.
- Dashboard API: index.html asset URLs are versioned by file mtime so browsers
  never cache stale JS/CSS after updates.
- **Groups are now season-scoped**: the site reuses group ids with different
  meanings across seasons (e.g. id 26 = U13 in s32 but U11 GROUP A in s31), so
  `groups` is keyed by `(season_id, group_id)` and the dashboard's Group
  dropdown lists only the selected season's groups (age-sorted), resetting when
  the season changes.
- Validation: season-31 official standings are partial/frozen snapshots on the
  site, so `validate.py` compares them strictly only when the standings volume
  matches the recorded games, otherwise warns.
- Dashboard: missing game/team/player ids now show a friendly "Not found"
  message instead of hanging on "Loading…" (no console errors).
- Dashboard: team "Scoring by game" chart is now **compact** — capped width
  (≤640px, centered) and a lower height (170 viewBox) so it no longer dominates
  the page. Also fixed the bar-chart SVG height so per-chart heights actually apply.
- Commits: local only — deployed when requested.

## [v4.3] — 2026-08-16 — Deployed-vs-source validator
- New **`crosscheck.py`**: samples 10 random box-score stats per game per player
  from the deployed dashboard (hellovic.github.io/hillen-league) and compares
  them against the live source (hillen-sports.com/hillenyouth). Reports
  per-group + overall summary and a detail line per discrepancy (stat value,
  score, status, missing player, unparseable page). Seeded sampling for
  reproducible runs; exit 0 = clean, 1 = discrepancies, 2 = operational failure.

## [v4.2] — 2026-08-16 — Scoring by quarter → compact table
- Game page: replaced the scoring-by-quarter **bar chart** with a compact
  quarter-by-quarter **table** (OT column only shown when OT was played).
- Commits: `1298d8d`

## [v4.1] — 2026-08-16 — Chart & compare fixes
- Compare highlight: better-value marking now compares **numerically**
  (e.g. Points/game "2.0" vs "11.0" highlights 11.0, not 2.0; turnovers/fouls
  highlight the lower value).
- Team "points trend" redesigned: per-game **green/red bars** (scored/conceded)
  with values on the bars and date+result (W/L) labels — applied to the team
  page and the team-comparison view.
- Bar charts: fixed **x-axis label alignment** (date labels were shifted right
  of their bars when there were few bars).
- Player head-to-head: lines now show **each player's per-game stats** for the
  shared game (were season totals / wrong field / wrong player).
- Commits: `5fccb39`, `bf19e78`, `118cbb3`

## [v4.0] — 2026-08-16 — Compare, charts, CSV, validation
- New **Compare** tab: pick two players or two teams (shareable URL
  `#/compare/p/<idA>/<idB>`), side-by-side stats with better value highlighted,
  radar chart, per-game charts, and head-to-head meetings with series record.
- **Charts** (dependency-free SVG): team scoring trend, player points-per-game +
  radar vs group average, game scoring-by-quarter.
- **CSV export** buttons on every table (standings, teams, players, games,
  box scores, game logs, rosters) — Excel-friendly (UTF-8 BOM).
- **`validate.py`** data validation suite: 7 reconciliation checks
  (box-score sums, quarter sums, standings match, forfeit/not-played/DNP rules,
  referential integrity); exit 0 = clean.
- Commits: `457685f`

## [v3.1] — 2026-08-16 — Group dropdown ordering
- Group dropdown sorted by **age group** (U9 → U11A → U11B → U13 → U15).
- Commits: `e530bb3` (after `1a772c4`, alphabetical, on request)

## [v3.0] — 2026-08-15 — All five Youth Girls groups
- Added **YOUTH GIRLS U9** (group 27) and **YOUTH GIRLS U15** (group 30);
  refreshed **U11A** with a new completed game.
- 5 groups, 27 teams, 40 games, 326 players.
- Commits: `4c8be90`

## [v2.2] — 2026-08-15 — Cache-busting on GitHub Pages
- GitHub Pages caches assets ~10 min; every static export now versions asset
  URLs with a build stamp (`index.html?v=…`, `data/…?v=…`) so viewers get the
  latest build immediately after a deploy.
- Commits: `6b1fd51`

## [v2.1] — 2026-08-15 — Mobile-friendly dashboard
- Wide tables scroll inside cards with a **pinned identity column** (player/team
  name stays visible while panning); responsive header/tabs; no page-level
  horizontal overflow; 16px inputs to stop iOS zoom.
- Commits: `8f4d9b8`

## [v2.0] — 2026-08-15 — U11A & U11B + forfeit handling
- Added **YOUTH GIRLS U11A** (group 28) and **U11B** (group 31).
- **Forfeit games** (default score, nobody played): stored as `status='forfeit'`,
  counted in team records as a win for the higher-scoring team and 棄 for the
  loser — `v_team_season_totals` matches the official 分組表.
- Cross-group detail navigation fix; forfeit UI (badge + game page message).
- Commits: `c3cca31`

## [v1.1] — 2026-08-15 — GitHub Pages deployment
- Static export mode (`server.py --export docs`), dual-mode frontend (live API
  locally / static JSON on hosts), deploy to **hellovic.github.io/hillen-league**.
- Commits: `6fb50b4`, `84a34e3`

## [v1.0] — 2026-08-15 — Initial release
- SQLite database (`hillen_league.db`) for **YOUTH GIRLS U13** (group 26,
  season 32): 7 teams, 8 games, 89 players, full box scores, standings,
  leaderboards.
- Stdlib-only scraper (`scraper.py`) + dashboard (`server.py`, `dashboard/`).
- Commits: `df88c33`
