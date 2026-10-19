# Changelog

All notable changes to the Hillen League database, scraper, and dashboard.
Format follows deployed versions; each entry lists the user-visible changes.

## [v5.1] — Unreleased — Dashboard feature bundle
- **The published site is now the React dashboard** — `server.py --export docs`
  builds `react-dashboard/` with Vite and writes one inline data bundle
  (`league-data.js`, ≈3.1 MB raw / ≈270 KB gzipped) in place of the ~1,800
  `data/*.json` files, so any route renders from a single payload with no fetch
  waterfall. The 871 share/preview stubs and their `og:`/`twitter:` tags are
  unchanged and "Copy link" still hands out those URLs; asset URLs keep a
  `?v=<build stamp>` query and Vite asset names are now stable, so a deploy can
  never 404 a page that is still cached (Pages caches for 10 minutes). PostHog
  route pageviews are preserved (each `#/…` route reports as its own page).
  The data bundle is referenced relatively (`./league-data.js`) because the site
  lives under `/hillen-league/`; the export normalises the path server-side,
  since a CI checkout has no local data snapshot for Vite to resolve. Building
  needs Node.js 22+ (`npm ci --prefix react-dashboard`); both workflows install
  it. The legacy vanilla `dashboard/` stays in the repo as the local dev UI of
  `python3 server.py`.
- **Mobile-first UX pass — all seven High items** — the phone experience was rebuilt around the brief's findings: header overhead drops from 243 px to 113 px (brand + theme, then search + an `S33 U13` filter chip that opens the season/group picks); Overview is now genuinely group-scoped (stats, Latest results, pending fixtures, Next on court, and “All games” all follow the selected group, with an explicit “All groups in Season N” browser); fixture states are modelled once (`Final` / `Forfeit` / `Skipped` / `Scheduled`; unplayed fixtures are treated as skipped, so they never appear as results or in the standings while remaining visible in the Games list, and missing scores never render as 0); groups without results show honest empty states instead of fake leaders and all-zero tables; search ranks the current group first and labels `This group` / `Season N` / `Other seasons`; phone tables default to a compact column set with an “Advanced stats” / “Full box score” disclosure, a swipe hint when a table still overflows, `aria-sort` on the headers, and Compare fits a 320 px screen (radar hidden there). Verified at 320/375/390/430 px and 1440 px in both themes; the headless suite grew from 31 to 54 checks, all passing.
- **Dashboard audit pass** — a full desktop + phone screenshot review of every view fixed the remaining alignment breaks: the score separators now sit on the digits' centre line, the 最佳表現 客隊 header lines up with its column, the NIL placeholder is muted, latest results on Standings are full-width and left-aligned (an unplayed fixture reads `Home — Away` instead of a double dash), the player page pairs Per game with the radar chart and caps the points chart, Compare's player cards show GP/PPG/RPG/APG, and phone tables got tighter side padding plus hidden Manager/Captain columns so the Teams and Standings tables fit their cards. Compare's pickers were repaired as part of the same pass: choosing one side no longer snapped back, and picking both now navigates to the comparison instead of requiring a hand-built URL.
- **Season switcher updates the overview** — changing the Season picker on the
  Overview page now swaps the whole page (stats, latest results, group cards);
  before, only the address bar changed while the old season's content stayed on
  screen. The router updates its state after the `history.replaceState` URL
  write instead of waiting for a `hashchange` event that replaceState never
  fires. The headless smoke test now covers it.
- **Season picker shortened** — the picker now reads `33 · 第33屆驍籃` instead
  of the full `第33屆驍籃青少年籃球聯賽` (full name kept as its tooltip), and its
  box is capped at 150 px on desktop / 152 px on phones, so the Group picker —
  whose names are the long ones — gets the rest of the row instead of truncating.
  Below 380 px the picker type drops one step so both labels stay intact. Label
  derived by `seasonShortName()` in `react-dashboard/src/data.js`; widths in
  `tweaks.css`.
- **Players list — long names no longer steal the stat columns** — the Player
  column is sticky, so an unusually long name (for example “Sit Sung Ning Kitty”)
  widened it until it filled most of a phone screen and pushed PPG, PTS, RPG…
  out of reach. Names are now capped (9em on a phone, 13em on a desktop) and end
  in “…” with the full name in a hover tooltip; the Players table also tightens
  its gutters on desktop so a long-name group still fits its card.
- **Phone bottom bar — six destinations** — the phone navigation now has six
  slots: Overall, Standings, Games, Leaders, Compare, and More, with Teams and
  Players moved into the More menu. The design layer's five-column bar is widened
  in `tweaks.css` (9 px labels, tighter gaps) so all six fit a 360 px phone; the
  desktop rail keeps all seven views. Smoke test now covers the order, both new
  top-level tabs and the More menu's contents (29 checks).
- **Game page — 最佳表現 readability** — in the Best Performance table the player
  names drop from 16 px to 13 px, and the PTS / 2PT / 3PT / FT labels change from
  16 px accent orange to 10 px body text (white on dark, near-black on light), so
  the two point columns read first. Purely a style layer
  (`react-dashboard/src/styles/tweaks.css`); the design files stay untouched.
- **Stat-table headers stay on screen while you scroll** — the Players list and
  the game page's box-score columns (PTS, REB, AST…, and the 最佳表現 table) now
  keep their title row pinned to the top of the window, so you can read a stat
  without scrolling back up to learn which column is which. `base.css` already
  declared the header sticky, but the design layer makes each table card a
  horizontal scroll box, which pinned the header to the card instead of the
  window. Whenever a table fits its card (`SortTable` measures it, and re-measures
  after sorting or changing group), the card goes back to a plain block and the
  header sticks. A table that needs sideways scrolling — a 16-column box score on
  a phone, or a group whose names are extra long — keeps its scroll box, and its
  header row is mirrored into a fixed strip pinned to the top of the screen that
  pans with the card, so phones get the same always-visible column titles instead
  of a page-wide scrollbar. Scoped to `react-dashboard/src/styles/tweaks.css` and
  `SortTable`, design files untouched; the smoke test now checks the pinned strip
  on the Players and Game pages at 390 px (31 checks).
- **Season overview is the landing page** — a bare visit now opens `#/season/33`,
  a page per season listing every group as one card: teams, games played, and the
  leader with its record, each linking to that group's standings. Two cards per row
  on a phone (`grid-template-columns: repeat(2, minmax(0, 1fr))` under 768px), as
  many as fit on a desktop. Below the grid, **Latest games played** lists the last
  eight results — date, group badge, both teams and the score with the winner in
  bold — and **Upcoming games** lists the next five fixtures with the tip-off time
  where the score would be. Games recorded as not played are left out of both, and
  each row opens that game's page. A section with nothing to list collapses to a
  single line (heading and note side by side) instead of a tall empty card. The data comes from a new `season_payload()` in server.py, served as
  `/api/season?season=` and exported as `data/season/<id>.json`, so the page costs
  one request instead of one per group. Groups are listed in age order (the same
  rule as the group switcher, now shared), an unknown season lists the seasons that
  exist, and each season also gets a share page (`seasons/33/`) so the landing URL
  previews properly: `7 groups · 24 teams · 6 games (5 played)`.
- Data refresh 2026-10-19: 140 games, 3392 box-score rows (seasons 31, 32, 33). 0 new, 2 updated, 0 removed, 138 unchanged.
- **A stale past-season table no longer blocks the daily refresh** — `validate.py`
  held *every* season's 分組表 to a strict comparison with the computed team
  records whenever the two agreed on games played, so once the league's own table
  drifted for a finished season the refresh aborted and published nothing (three
  scheduled refreshes failed on 2026-10-18). Strictness now applies to the current
  season only; earlier seasons report the same comparison as a warning. The trigger
  was season 32 · YOUTH GIRLS U15, whose table had half-applied the two 10-10
  fixtures — a win added for Pusion U15Girls B and a loss for Soar U15 Girls, but
  not the matching rows for their opponents — so three teams disagreed with the
  league's own results even though the schedule holds exactly the 8 fixtures the
  games table holds.
- Data refresh 2026-10-18: 140 games, 3351 box-score rows (seasons 31, 32, 33). 0 new, 1 updated, 0 removed, 139 unchanged.
- **The site opens on season 33 · YOUTH GIRLS U13** — a bare visit used to land on
  season 32 · U13 (group 26), the season the dashboard was born in. The landing
  season/group is now served by `/api/meta` (`default_season` / `default_group`)
  and applied by `init()` before the first render, so it is edited in one place
  (`server.py`) instead of two hardcoded numbers in `dashboard/app.js` — which
  never read the values it was being served. A configured group that is not in
  the season falls back to that season's first group.
- Data refresh 2026-10-17: 139 games, 3351 box-score rows (seasons 31, 32, 33). 0 new, 1 updated, 0 removed, 138 unchanged.
- Data refresh 2026-10-14: 139 games, 3329 box-score rows (seasons 31, 32, 33). 3 new, 0 updated, 0 removed, 136 unchanged.
- Data refresh 2026-10-11: 136 games, 3329 box-score rows (seasons 31, 32, 33). 0 new, 1 updated, 0 removed, 135 unchanged.
- **All seven season-33 Youth Girls divisions now appear** — the league site lists
  U9 A (25), U9 B (26), U11 A (11), U11 B (27), U11 C (28), U13 (16) and U15 (29),
  but the refresh only scraped 11 and 16, so five divisions whose teams were
  already registered never showed up in the dashboard — no matter how often the
  daily refresh ran. All seven are scraped now, played or not: U9 A has one
  fixture, U9 B / U11 B / U11 C have none yet, and U15 has no teams at all. The
  export also stopped deriving the group list from played fixtures, so a division
  the league has opened but not yet scheduled still gets a page (an explicit
  `No data` table) instead of disappearing from the switcher. Share pages go from
  825 to 859 (17 season+group pages).
- **The generated site is no longer committed** — `docs/` is build output
  (~2,000 files: the JSON the dashboard fetches plus one share page per game,
  team, player and standings table), so it is gitignored and published as a
  **GitHub Pages artifact** built inside the workflow. The repo drops from 2,117
  tracked files to ~20 project files plus the database, while the published site
  stays byte-for-byte the same — same URLs, same previews. `refresh.yml` uploads
  what `./start.sh` built; the new `deploy.yml` rebuilds and republishes on a
  push. Requires **Settings → Pages → Source = "GitHub Actions"**.
- **Season and group now live in the URL** — `#/standings?season=33&group=11`
  opens exactly that table, so a standings link is shareable the way a game link
  already was. The season/group dropdowns (and the tabs) previously only mutated
  in-memory state, so the address bar kept saying `#/standings` while showing
  another season and any copied link landed on the default. They now write the
  pair into the fragment with `history.replaceState` — a refinement of the current
  page, so Back still leaves the view instead of rewinding through every season
  you tried. `route()` validates both (an unknown season is ignored, an unknown
  group falls back to that season's first group) and the positional player form
  `#/players/<id>/<season>/<group>` still works. Compare links carry the context
  too, since their pickers list one season's group, and PostHog page paths strip
  the query so `/standings` does not become one row per season visited.
- **One share page per season+group** — `groups/<season>/<group>/` (17 today)
  whose card names the top of that table, e.g. `1. 永青 2-0 · 2. 林文燦 1-1 ·
  3. Dreams Team U11 0-1 · 5 teams · 第33屆驍籃青少年籃球聯賽`, so a standings
  link previews the table instead of the generic league card. 859 share pages in
  total. `write_share` now derives how far to climb out of a stub from the id it
  is handed (`../../` for `games/20863/`, `../../../` for `groups/33/11/`); the
  first cut hardcoded `../../`, which sent a group link to a directory listing.
- **The standings table is ordered by points** — `division.php` lists a group's
  teams in entry order and only starts agreeing with the points once games are
  played, so a team that has not played can head a table. `standings_rows()`
  (server.py) now sorts by points descending, keeping the official listing order as
  the tiebreak — that order is the league's own tiebreak once teams are level — and
  numbers the rows `1..n` as `pos`. The `#` column, the CSV export and the group
  share card all show `pos`; the scraped order is kept in the database as `rank`. A
  group whose official order already was the points order is unaffected
  (`pos == rank`): as of the 2026-10-14 refresh that is every group except season
  33's U11 (group 11, `St.Patrick's School` on 0 games listed first) and U13
  (group 16, `Wishful U13` and `康仁` both on 0 games listed first).
- Data refresh 2026-10-10: 136 games, 3260 box-score rows (seasons 31, 32, 33). 0 new, 1 updated, 0 removed, 135 unchanged.
- Data refresh 2026-10-08: 136 games, 3233 box-score rows (seasons 31, 32, 33). 9 new, 2 updated, 0 removed, 125 unchanged.
- **Link previews are text-only** — `og:image` and `twitter:image` were removed
  from both the site-level card (`dashboard/index.html`) and every generated share
  page, and `twitter:card` changed from `summary_large_image` to `summary` so no
  image slot is reserved. A thumbnail dominates a WhatsApp message, and the only
  image on offer was a generic league banner standing in for a specific game. The
  preview now shows just the title and description (score, date, venue, season…).
  Share pages contain no `<img>` at all, so a crawler cannot fall back to one.
  `make_og.py` and `og.png` are kept but unused; restoring the banner is two lines.
- **Shareable links that actually preview** — a `#/games/20863` link could never
  carry the game's details: a URL fragment is never sent to the server, so WhatsApp
  fetches exactly the same bytes as the home page and shows the generic league
  card. `export_static` now also writes one small stub page per game, team and
  player (`games/20863/`, `teams/1595/`, `players/15376/`) whose `<head>` holds
  that entity's own `og:`/`twitter:` description — score, date, time, venue and
  season for a game; record, PF/PA and roster size for a team; GP and PPG/RPG/APG
  for a player — then forwards the visitor into the existing hash route via
  `location.replace` (JS-only, so a crawler never follows it; a plain link covers
  JS-off) and is marked `noindex`. Every detail page gained a **🔗 Copy link**
  button, because the address in the browser bar is the unshareable form. Player
  links encode season and group (`#/players/15376/32/31`) since a player id repeats
  across seasons, and the router now honours those extra segments. 813 pages
  generated for 136 games / 51 teams / 626 players (~1 KB each; `docs/` 5.5M → 8.7M
  on disk). Generated by `server.py` itself so the daily refresh keeps them.
- **Season 33** (第三十三屆驍籃青少年籃球聯賽) added — the live season's two Youth
  Girls groups: **YOUTH GIRLS U11 GROUP A** (group 11) and **YOUTH GIRLS U13**
  (group 16). 6 teams, 4 games (2 played so far), 50 box-score rows. The season is
  still early, so more groups will appear as it progresses. The dashboard's season
  switcher picks it up automatically from `meta.json` — no frontend change was
  needed, and the default season deliberately stays 32 (season 33 has few games
  yet). Note group ids are season-scoped: `11` is YOUTH GIRLS U11 GROUP A in s33
  but U11 GROUP A (boys) in s32.
- The same refresh picked up the season-32 fixtures that had since been played
  (**9 new games, 2 that went `scheduled` → `completed`**, incl. event 20726 and
  20727 both finishing 2026-09-06), because season 32 was still running alongside
  season 33.
- Data refresh 2026-10-07: 132 games, 3183 box-score rows (seasons 31, 32). 3 new, 0 updated, 0 removed, 129 unchanged.
- Data refresh 2026-10-04: 129 games, 3183 box-score rows (seasons 31, 32). 0 new, 1 updated, 0 removed, 128 unchanged.
- Data refresh 2026-09-30: 129 games, 3183 box-score rows (seasons 31, 32). 1 new, 0 updated, 0 removed, 128 unchanged.
- Data refresh 2026-09-20: 128 games, 3135 box-score rows (seasons 31, 32). 0 new, 1 updated, 0 removed, 127 unchanged.
- Data refresh 2026-09-16: 128 games, 3135 box-score rows (seasons 31, 32). 3 new, 0 updated, 0 removed, 125 unchanged.
- Data refresh 2026-09-12: 125 games, 3110 box-score rows (seasons 31, 32). 0 new, 1 updated, 0 removed, 124 unchanged.
- Data refresh 2026-09-09: 125 games, 3089 box-score rows (seasons 31, 32). 2 new, 0 updated, 0 removed, 123 unchanged.
- Data refresh 2026-09-06: 123 games, 3036 box-score rows (seasons 31, 32). 0 new, 1 updated, 0 removed, 122 unchanged.
- Data refresh 2026-09-05: 123 games, 3012 box-score rows (seasons 31, 32). 0 new, 2 updated, 0 removed, 121 unchanged.
- Data refresh 2026-09-01: 123 games, 2991 box-score rows (seasons 31, 32). 5 new, 0 updated, 0 removed, 118 unchanged.
- Data refresh 2026-08-30: 118 games, 2969 box-score rows (seasons 31, 32). 0 new, 1 updated, 0 removed, 117 unchanged.
- Data refresh 2026-08-29: 118 games, 2917 box-score rows (seasons 31, 32). 2 new, 2 updated, 0 removed, 114 unchanged.
- **Shooting efficiency** (A1): eFG% and True-Shooting % for every player — added
  as sortable columns on the Players table, plus eFG%/FT%/TS% on the player
  page's season stats and new eFG%/TS% rows in Compare.
- **+/- and fast-break surfacing** (A2): a sortable **+/- (season)** column on the
  Players table, and Fast-break / Blk-against on the player page + Compare.
- **Leaders tab** (A4): a new category-based view of the league's own leaderboards
  (MVP, 得分王, 三分王, 助攻王, 偷截王, 罰球王, 籃板王, 封阻王) with CSV export and
  click-through to players/teams. Backed by a new `/api/leaders?season=&group=`
  endpoint and `leaders.json` in every static export.
- **Global search** (A5): a header search box that matches **across all
  seasons/groups** (players, teams, and games by team or venue) and jumps to the
  matching page.
- **Light/dark theme toggle** (A1/D1): a 🌙/☀️ button in the header, persisted to
  `localStorage` and defaulting to the system light preference on first visit.
- **Data-refresh timestamp** (D4): the footer now shows **data refresh
  `YYYY-mm-dd HH:mm:ss`** — the time the data was last refreshed, in Hong Kong
  time (consistent whether it ran locally or on GitHub Actions). The timestamp is
  **stored in the database** (`refresh_meta`, written by `start.sh` after a full
  refresh) rather than derived from the file mtime, so it survives git checkouts
  and dev-side scrapes. Replaces the previous "data through `<game date>`" label
  (a game date can be a future scheduled fixture and was confusing). The build
  stamp now includes this timestamp, so a refresh always cache-busts and the
  footer updates immediately.
- Reverted the Games-list redesign (A6) back to the previous flat, sortable table
  per feedback; the `+/-` column is also hardened to show "—" instead of
  "undefined" when a backend/build lacks the field.
- **Daily refresh now covers the two live seasons (32 and 33)** — season 32
  (U13 26, U9 27, U11A 28, U15 30, U11B 31) and season 33 (U11 GROUP A 11,
  U13 16). Season 31 is finished (its results are frozen), so it is no longer
  re-scraped; its data stays in the DB and dashboard for reference. Also fixed
  the refresh loop scraping the phantom group `1001` (a `GROUPS` variable-name
  collision with an environment variable).
- New API/payload fields: `plus_minus`, `fb`, `ba` in `/api/players`; `min/max_game_date`
  in `/api/meta`.
- Commits: local — deployed when requested.

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
