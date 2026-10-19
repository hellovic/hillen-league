# Working agreement — Hillen League

Standing instructions for agents working in this repo. They sit on top of the
global house rules in `~/.dsh/AGENTS.md` (explanation style, formatting).

## Git: commit major changes automatically

After a change is implemented and verified, **commit it without being asked**.
Do not batch unrelated work into one commit, and do not leave the tree dirty
when a piece of work is finished.

Commit straight away when the change is **major**:

- a new view, component, or feature;
- a visual/design pass (layout, spacing, alignment, theming);
- a behaviour fix (routing, pickers, filtering, sorting, share links, export);
- anything touching `server.py`, `.github/workflows/`, `react-dashboard/vite.config.js`,
  `package.json`, or the data bundle;
- a README/CHANGELOG update that documents shipped work.

Leave it uncommitted (mention it instead) when the change is **minor**:

- typo, comment, or formatting only;
- screenshots/`design/` regeneration with no code change;
- work in progress that does not build or fails `npm run verify`;
- anything the user asked to review first.

Rules:

- Verify before committing: `npm run verify --prefix react-dashboard` after UI
  changes; `python3 -m py_compile server.py` plus a `python3 server.py --export`
  smoke run after `server.py` changes.
- Commit identity is repo-local: `Hillen League <hillen@local>`.
- Subject line: imperative, ≤ 72 characters, no trailing period. Body explains
  the *why* and any measured numbers.
- Never stage `design/` (screenshots/evidence), `docs/` (build output),
  `node_modules/`, `__pycache__/`, or `.DS_Store` — they are untracked or
  ignored on purpose.
- One logical change per commit; rebase/amend only your own unpushed commits.

## Deploy: only on an explicit request

- `git commit` is local. **Never** `git push` or trigger a deploy unless the
  user asks for it in that turn.
- `deploy.yml` publishes only on a push to `main`; branch pushes build nothing.
- After an explicitly requested push, wait for the run, then verify the live
  site with a fresh Chrome profile (`rm -rf /tmp/hl-verify-profile` first —
  a stale profile caches the previous `index.html` and fakes failures):
  `VERIFY_BASE=https://hellovic.github.io/hillen-league node react-dashboard/scripts/verify.mjs`.
  GitHub Pages caches `index.html` for ~10 minutes.

## Where things live

- `react-dashboard/` — the published React app (Vite). `npm run dev` →
  http://localhost:5173, `npm run verify`, `npm run data` refreshes the local
  `public/league-data.js` snapshot.
- `dashboard/` — the legacy vanilla UI served by `python3 server.py` (dev only).
- `server.py` — SQLite scrape/API/export; `--export docs` builds the React app,
  writes the inline data bundle, and emits the OG/share stubs.
- `design/` — untracked screenshots, baselines, and audit captures.
