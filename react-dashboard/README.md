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
19 checks, 19 passed, 0 failed
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
- `src/styles/tweaks.css` layers small product tweaks on top of the design
  layer (currently the game page's 最佳表現 table and sticky table headers on
  desktop, see deviations 6 and 7). It is the only other rule-bearing file
  besides `desktop-fix.css`, and neither edits `base.css` or `design.css`.

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
VERIFY_BASE=http://127.0.0.1:8010 npm run verify:site   # 19 checks
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
