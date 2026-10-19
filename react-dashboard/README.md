# Hillen League — React dashboard (Courtside Orange)

A runnable React port of the Open Design project **“Dark Basketball Dashboard
Designs”** (`9ac966f9-f287-4f65-b35e-59bfaeb29a5d`). The visual language —
tokens, typography, sidebar rail, mobile bottom navigation, cards, tables,
charts and light/dark theming — is the design system Open Design produced; this
project re-implements the behaviour in React components so it can be developed
and shipped as a normal front-end app.

> This app is what `python3 server.py --export docs` **publishes to GitHub
> Pages**: the export runs `vite build`, writes the data bundle next to it and
> keeps the per-entity share stubs. The legacy vanilla dashboard in
> `../dashboard/` is unchanged and is still what `python3 server.py` serves
> locally. See [Deploying](#deploying-serverpy---export).

## Commands

```bash
cd react-dashboard
npm install          # first time only (Node 22+)
npm run data         # regenerate public/league-data.js from ../hillen_league.db
npm run dev          # dev server  → http://localhost:5173
npm run build        # production bundle → dist/
npm run preview      # serve dist/   → http://localhost:4173
npm run verify       # build + headless smoke test (needs Google Chrome)
```

`npm run verify` starts the **production** preview server, drives Chrome through
the DevTools protocol and asserts routing, per-view `<title>`, table sorting,
global search, theme switching/persistence, box-score sorting, inline SVG
charts, mobile navigation, absence of uncaught exceptions and — the layout
acceptance test this design needs — **zero horizontal overflow at 390 px and
1440 px on all ten routes**. It prints `PASS/FAIL` per check and exits non-zero
on failure:

```
62 checks, 62 passed, 0 failed
```

Chrome is located automatically on macOS; elsewhere set `CHROME_PATH`.

## What is preserved

- `src/styles/base.css` and `src/styles/design.css` are **byte-for-byte copies**
  of the OD project’s `base.css` and `design.css`. No design token, rule or
  class was edited, so the design layer remains the design layer.
- Shell: sticky top bar, brand block, season/group selects, theme toggle,
  “LEAGUE” sidebar rail at ≥1024 px, fixed bottom nav + “More” sheet below
  768 px, data footnote.
- Views: Overview (season stats, latest results, group/division cards),
  Standings, Teams, Team detail, Players, Player detail, Games, Game detail
  (scoreline, quarters, 最佳表現, per-team box scores), Leaders, Compare
  (players and teams: head-to-head tables, radar, grouped bars).
- Behaviour: hash routing (`#/standings?season=33&group=16`, deep links,
  detail links), context adoption from detail payloads, sortable tables,
  global search with cross-group jumps, share-link copy, CSV downloads, theme
  persistence in `localStorage["courtside-theme"]`, chart palette switching.
- Three small product layers sit on top of the design, none of them editing
  `base.css` or `design.css`: `src/styles/tweaks.css` (最佳表現 table, sticky
  header `.fit` rule, phone-only pinned header strip — deviations 6, 7, 11),
  `src/styles/ux-header.css` (compact phone header, deviation 13) and
  `src/styles/ux-tables.css` + `ux-scope.css` (phone column budgets, scroll
  hints, fixture status badges, scope headers — deviations 14-18).

## Deviations from the OD build (and why)

| # | Difference | Why |
|---|---|---|
| 1 | Desktop ≥1024 px centres a full-width `<main>` instead of shrink-to-fit content | `base.css` still carries the old `main{margin:0 auto}`, which inside the new grid makes the content column depend on the view’s intrinsic width (season ≈512 px, compare ≈1192 px). Fixed in `src/styles/desktop-fix.css`, scoped to ≥1024 px. |
| 2 | Desktop dashboard is two columns (results left, divisions right) | `design.css` had an unscoped `body.orange .dashboard-grid{grid-template-columns:1fr}` that clobbered the desktop two-column definition. The same fix file restores it at ≥1024 px. |
| 3 | Unplayed games render blank score cells instead of the literal text `null` | The vanilla templates interpolated `null`; the port renders an empty cell. |
| 4 | A few text runs are pixel-different by antialiasing only | JSX splits dynamic strings into several text nodes, so kerning across node boundaries differs by a fraction of a pixel. Normalised `innerText` and markup structure are identical to the OD build. |
| 5 | “Copy link” copies the share-stub URL (`games/20863/`, `players/17864/`…), not `location.href` | The OD build copied the hash URL, which chat apps cannot preview (crawlers never see the fragment). The static export writes an OG stub per entity; copying that URL keeps the vanilla app's link-preview feature. |
| 6 | 最佳表現 table: player names 13 px (was 16 px), stat labels 10 px in body-text colour (was 16 px accent orange) | Requested readability tweak on the game page — the PTS/2PT labels are captions between the two point columns and should not compete with them. Scoped rules live in `src/styles/tweaks.css`. |
| 7 | Stat-table headers stick to the top of the viewport while the table scrolls, whenever the table fits its card | `base.css` already declares `table.data th{position:sticky;top:0}`, but `design.css` turns every table card into a horizontal scroll container (`.card:has(table){overflow-x:auto}`), which defeats vertical sticky. `SortTable` measures `table.scrollWidth` against `card.clientWidth` and adds `.fit` to the card when the table fits; only then does `tweaks.css` restore `overflow:visible`, so a table that needs sideways scrolling keeps its scroll box and inline header instead of becoming a page-wide scrollbar. |
| 8 | Player names in the pinned Player column are capped (9em on phones, 13em from 768 px) and ellipsized, with the full name in the link's `title`; Players-table gutters shrink to 8 px from 768 px | A group with long English names (e.g. “Sit Sung Ning Kitty”) widened the sticky column until it took most of a phone screen and pushed every stat out of reach. Clamping the link caps both the column and the table's intrinsic width. |
| 9 | Phone bottom bar has six items — Overview, Standings, Games, Leaders, Compare, More (Teams, Players) — instead of four plus a three-item More menu | Requested navigation layout: the most-used views get a permanent slot, and Teams/Players move under More. Labels drop to 9 px and the grid to `repeat(6, …)` in `tweaks.css` so six labels still fit a 360 px screen; the desktop rail keeps all seven views. |
| 10 | Season picker shows `33 · 第33屆驍籃` (and a full-name `title`) instead of the full league name, and its box is capped at 160 px on desktop / 152 px on phones so the Group picker keeps the rest of the row | Requested: the long season names squeezed the Group picker, whose names are the ones that must stay readable. The label is derived in `seasonShortName()` (`src/data.js`) by dropping the `青少年…` tail; below 380 px the picker type drops to 14 px so `YOUTH GIRLS U13` still fits next to it. |
| 12 | Audit pass over every view (2026-10-19): scoreboard dash sits on the digits' optical centre; 最佳表現 客隊 header is right-aligned over its cells and the NIL placeholder is muted instead of accent-coloured; Standings latest results are full-width left-aligned and an unplayed fixture reads `Home — Away` instead of `— – —`; the player page pairs Per game with the radar and gives the points chart its own 760 px-capped card; Compare's player summary cards carry GP/PPG/RPG/APG; phone tables use 8 px side padding (the standings table fits its card again) and the Teams table hides Manager/Captain below 768 px so its ± column no longer clips | The desktop/phone screenshot audit found these as the only real alignment breaks; everything else matched the OD build. Table-density rules live at the bottom of `tweaks.css` next to the sticky-header block. |
| 11 | On phones (and any window narrower than the table) the header row of a table that must scroll sideways is mirrored into a fixed strip pinned to the top of the screen, kept in sync with the card's horizontal scroll | `position: sticky` is resolved against the nearest scroll container; `design.css` makes the table card that container for sideways scrolling, so the header cannot follow the page. The strip is a portal inside `SortTable` (`thead-pin`), shown only while the real header is off-screen; it is `aria-hidden`, its cells are not focusable, and tapping it still sorts. Tables that fit their card keep the plain sticky header (deviation 7). |
| 13 | Phone header is compact but keeps both pickers in the open: brand + theme row, full-width search, then Season and Group side by side with their labels; header 243 → 186 px at 390×844 | Owner decision (2026-10-19): a chip + popover made changing season or group a two-step job, so the two selects stay visible and one change applies immediately. Group options use the short division token (`U11 A`) on phones — the full name stays in the select's `title` — which keeps both boxes usable at 320 px. Every control keeps a 44 px tap target; desktop markup is unchanged. Rules in `ux-header.css`; component in `components/Topbar.jsx`. |
| 14 | Overview is **season-wide** and labelled as such: the eyebrow reads `ALL GROUPS · SEASON 33`, totals (`7 Group · 24 Teams · 6 Games · 5 Played`) and Latest results/Next on court cover every division (each row carries its group chip), and the group cards are the drill-down. On this page the header's group picker is replaced by a static `All groups` marker (desktop) / “All groups” chip (phone); the picker only appears on group-scoped pages | Owner decision (2026-10-19): the overview must not be bound to one group. Earlier in the day it had been group-scoped; that was reverted. The season-wide payload (`season/<id>.json`, `latest_games` with `group_short`) supplies the mixed list, and “All games” was removed from the overview because no season-wide games route exists — the game rows and group cards are the navigation. |
| 15 | Fixture states are modelled once: `Final`, `Forfeit`, `Skipped` (past `not_played`), `Scheduled`. Unplayed fixtures are skipped — never listed as results and never counted in the standings or points chart; they remain visible in the Games list with a neutral `Skipped` badge. A missing score renders `—`/`vs`, never `0` | Brief UX-02. `gameStatus()`/`todayHk()` live in `src/utils.js`; badges come from `components/GameStatus.jsx` (`{ game, className }`). “Games” counts competitive fixtures only, so Played + Remaining equals Games. |
| 16 | Empty states explain themselves: zero-play groups say “No games played yet” on Overview cards and replace the Leaders tables / points-for chart with an explanation plus a fixtures link; a zero-team group says “No teams entered yet” | Brief UX-03/UX-19: a group with no results used to render a `LEADING TEAM … 0W · 0L 0 pts` card and eight all-zero leaderboards. `components/ScopeEmpty.jsx` centralises the copy. |
| 17 | Search ranks the current season+group first (exact → prefix → substring), then other groups of the season, then older seasons, and labels the dropdown `This group` / `Season N` / `Other seasons` | Brief UX-04: typing `Arouse` listed a season-31 player and two season-31 teams above the current `Arouse U13`. The ladder is documented in `searchMatches()`; the 30-result cap and cross-group adoption are unchanged. |
| 18 | Phone tables default to a compact column set (Players Player/Team/GP/PPG/RPG/APG; box score #/Player/MIN/PTS/REB/AST; roster and game log likewise) with an “Advanced stats” / “Full box score” disclosure; expanded tables gain a “Swipe sideways for more columns →” hint and right-edge shadow; headers expose `aria-sort`; Compare tables fit 320 px and the radar is hidden on phones | Brief UX-05/UX-21/UX-18. Column budgets are CSS in `ux-tables.css`, the disclosure is `components/MobileColumnsToggle.jsx` (44 px, `aria-expanded`), and desktop keeps every column exactly as before (verified 0 px diff). |
| 19 | Phone views default to compact column sets for **Standings** (`# / Team / W / L / Pts`) and **Teams** (`Team / GP / W / L / ±`), with “Full table” / “Full stats” disclosures; long club names are clamped with a `title` tooltip and points-for rows ellipsize | Owner review of UX-05/UX-21: the points column sat off-screen on a phone and long club names forced sideways scrolling at 320/375/390 px. Column budgets are CSS in `ux-tables.css`; the disclosure reuses `components/MobileColumnsToggle.jsx`; desktop is unchanged (all columns, no disclosure). |

Remove the `desktop-fix.css` import in `src/main.jsx` to get pixel parity with
the OD build at every width, including its desktop quirks. The `tweaks.css` import is independent of
this and can stay.

## Parity evidence

Screenshots in [`screenshots/`](screenshots/) are captured from this app and
were diffed against the OD build served from a copy of the original project
(`index.html + base.css + design.css + charts.js + app.js + league-data.js`):

- Mobile (390 × 844): byte-identical or antialias-only differences on all
  routes (`#/season/33`, `#/standings`, `#/players`, `#/teams`, `#/games`,
  `#/leaders`, details and compare).
- Desktop (1440 × 1000): identical except the two intentional layout fixes
  above.

## Analytics

PostHog is preserved: the loader is inlined in `index.html` (initialised only on
the real, non-localhost site) and `src/analytics.js` fires a `$pageview` with the
hash route as `$pathname` on every route change, plus a matching `$pageleave`.
Without that rewrite PostHog would collapse every route into one
`/hillen-league/` row; local `npm run dev` traffic is never counted.

## Data

`public/league-data.js` is `window.LEAGUE_DATA` — every payload the app reads,
keyed like the old static JSON (`meta`, `season/<id>`, `<season>/<group>/<path>`).
It is **git-ignored** (derived data, ~3.1 MB) and generated from the database:

```bash
npm run data    # == python3 ../server.py --export-data public/league-data.js
```

The same generator (`build_league_bundle()` in `server.py`) feeds the static
export, so the dev app and the published site always see identical data. The
bundle is loaded with a plain `<script>` before the app; `src/data.js` reads it
synchronously through the same `api(path, params)` shape the vanilla app used.
Swapping to per-route JSON fetches later only touches `src/data.js`.

## Structure

```
react-dashboard/
├── index.html               # body.orange, #root, OD layout primitives, theme bootstrap
├── public/league-data.js    # window.LEAGUE_DATA (generated, git-ignored)
├── scripts/verify.mjs       # headless smoke test (dev build or exported site)
├── screenshots/             # verification evidence
├── src/
│   ├── main.jsx             # stylesheet order: base.css → design.css → desktop-fix.css → tweaks.css
│   ├── App.jsx              # hash router, context, theme, shell composition
│   ├── data.js              # synchronous LEAGUE_DATA access
│   ├── utils.js             # titles, dates, sorting, share/CSV, context hashes
│   ├── theme.jsx            # light/dark chart palettes
│   ├── charts.jsx           # GroupedBars / LineChart / RadarChart (SVG)
│   ├── components/          # Topbar, Tabs, MobileNav, SortTable, SearchBox, …
│   ├── views/               # one component per route (season, standings, …)
│   └── styles/              # base.css, design.css (verbatim), desktop-fix.css, tweaks.css
```

## Deploying (`server.py --export`)

`python3 server.py --export docs` is the single deploy command (also run by
`./start.sh` and both GitHub Actions workflows). It:

1. `vite build --base ./ --outDir docs` — relative asset paths, so it works
   under `/hillen-league/` on GitHub Pages (or any sub-path).
2. writes `docs/league-data.js` (the bundle above, ≈270 KB gzipped).
3. writes the 871 share/preview stub pages (`games/<id>/`, `teams/<id>/`,
   `players/<id>/`, `groups/<s>/<g>/`, `seasons/<id>/`) whose `og:`/`twitter:`
   tags preview individual entities and then forward into the hash route.
4. injects `?v=<build stamp>` into every asset URL. Vite is configured with
   **stable asset names** (`assets/index.js`, not `assets/index-1a2b3c.js`) so
   the stamp is the only cache key — Pages' 10-minute cache can serve a stale
   build for a few minutes, but never a 404 for a deleted hashed file.

The stamp hashes the data (game rows + `refreshed_at`), the app sources,
`league-data.js` and `server.py`, so an unchanged re-export is byte-identical
while any refresh or code change busts every cached URL.

Requirements: **Node.js 22+** and `npm ci --prefix react-dashboard` (both
workflows do this; `server.py` prints the exact command if `node_modules` is
missing). CI steps added in `.github/workflows/deploy.yml` and
`refresh.yml`; `react-dashboard/**` is a trigger path for deploys.

Verify the exported site exactly as CI would ship it:

```bash
python3 server.py --export docs
python3 -m http.server 8010 --directory docs &
VERIFY_BASE=http://127.0.0.1:8010 npm run verify:site   # 62 checks
```

## Syncing back to the Open Design project

The OD project directory lives under `~/Library/Application Support/Open
Design/…`, which this sandbox cannot write to. Copy the app over from a normal
terminal if you want it visible inside Open Design:

```bash
cp -R react-dashboard/index.html react-dashboard/src react-dashboard/public \
      react-dashboard/package.json react-dashboard/vite.config.js \
  "$HOME/Library/Application Support/Open Design/namespaces/release-stable/data/projects/9ac966f9-f287-4f65-b35e-59bfaeb29a5d/"
```

The vanilla `../dashboard/` remains build-free and is no longer what the static
export publishes; it is only the local dev UI of `python3 server.py`. The
verification loop in `scripts/verify.mjs` is the contract to keep either way.
