/**
 * Headless smoke test for the built app.
 *
 *   npm run verify
 *
 * 1. starts `vite preview` on :4173 (production bundle, not the dev server)
 *    — unless VERIFY_BASE is set, in which case that URL is tested as-is
 *    (e.g. the site that `python3 server.py --export docs` produced)
 * 2. drives Chrome through the DevTools protocol
 * 3. asserts routing, sorting, search, theme, chart rendering and — the one
 *    thing the design must never regress — zero horizontal overflow at both
 *    390 px and 1440 px on every route
 *
 * Exits non-zero on the first failed group, so it can gate a deploy.
 * Chrome is located via CHROME_PATH, falling back to the macOS app bundle and
 * the usual Linux/Windows install locations.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const PORT = 4173;
// VERIFY_BASE=http://host:port/ verifies an already-running site (the exported
// static build, say) instead of starting `vite preview`.
const BASE = (process.env.VERIFY_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const EXTERNAL = !!process.env.VERIFY_BASE;
const ROOT = new URL("..", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error("Chrome not found. Set CHROME_PATH to run the verification.");
  process.exit(2);
}

// ---------------------------------------------------------------- preview server
const preview = EXTERNAL
  ? null
  : spawn(`${ROOT}node_modules/.bin/vite`, ["preview", "--port", String(PORT), "--strictPort"], {
      cwd: ROOT,
      stdio: "ignore",
    });
const stopPreview = () => {
  try { preview?.kill("SIGTERM"); } catch {}
};
process.on("exit", stopPreview);

for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch(BASE + "/");
    if (r.ok) break;
  } catch {}
  if (i === 99) {
    console.error(EXTERNAL ? "site not reachable at " + BASE : "preview server did not start on " + PORT);
    stopPreview();
    process.exit(2);
  }
  await sleep(100);
}

// ---------------------------------------------------------------------- chrome
const chrome = spawn(chromePath, [
  "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--remote-debugging-port=9345", "--user-data-dir=/tmp/hl-verify-profile", "about:blank",
], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} });

let version;
for (let i = 0; i < 80; i++) {
  try {
    version = await (await fetch("http://127.0.0.1:9345/json/version")).json();
    break;
  } catch { await sleep(200); }
}
if (!version) {
  console.error("Chrome did not expose a DevTools endpoint.");
  process.exit(2);
}

const ws = new WebSocket(version.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
};
await new Promise((r) => (ws.onopen = r));

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const target = await send("Target.createTarget", { url: "about:blank" });
const attached = await send("Target.attachToTarget", { targetId: target.result.targetId, flatten: true });
const session = attached.result.sessionId;
const sess = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, sessionId: session }));
  });

await sess("Runtime.enable");
await sess("Page.enable");
const evaluate = async (expression) => {
  const r = await sess("Runtime.evaluate", { expression, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const waitFor = async (expression, label, timeout = 6000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await evaluate(expression)) return; } catch {}
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label);
};
const setViewport = (width, height, mobile) =>
  sess("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
const open = async (hash) => {
  await sess("Page.navigate", { url: BASE + "/#" + hash });
  // Wait for the app to report the new route: navigating between two hashes of
  // the same document does not reload, so a plain "view has children" check
  // would pass against the previous page. The route marker drops the query.
  const route = hash.split("?")[0];
  await waitFor(`document.documentElement.dataset.route === ${JSON.stringify(route.slice(1))}`, "route " + route);
  await sleep(150);
};

// ---------------------------------------------------------------------- checks
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
};

await setViewport(1440, 1000, false);
await open("/season/33");
await evaluate(`[...document.querySelectorAll("#tabs button")].find((b) => b.dataset.view === "standings").click()`);
await waitFor(`location.hash.startsWith("#/standings")`, "standings hash");
await waitFor(`document.querySelector(".view-head h2")?.textContent === "Standings"`, "standings heading");
check("rail navigation updates route and heading", true);
check("per-view document title", (await evaluate("document.title")).includes("YOUTH GIRLS U13 - Standings - Season 33"), await evaluate("document.title"));

// Regression guard: changing the season must re-render the overview. The URL
// update goes through history.replaceState(), which fires no hashchange event,
// so the router has to refresh its own state (App.jsx syncUrl → setRoute).
await open("/season/33");
const startSeason = await evaluate(`document.querySelector("#season-select").value`);
// The season-wide overview renders no group picker; remember the group only if
// one exists (it does on the group-scoped pages used later).
const startGroup = await evaluate(`(() => { const sel = document.querySelector("#group-select"); return sel ? sel.value : null; })()`);
const overviewBefore = await evaluate(`document.querySelector("#view .season-stats")?.innerText.replace(/\\s+/g, " ")`);
const switchedTo = await evaluate(`(() => {
  const sel = document.querySelector("#season-select");
  const other = [...sel.options].map((o) => o.value).find((v) => v !== sel.value);
  sel.value = other;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return other;
})()`);
await waitFor(`document.documentElement.dataset.route === "season/${switchedTo}"`, "season switch route");
await sleep(150);
const overviewAfter = await evaluate(`document.querySelector("#view .season-stats")?.innerText.replace(/\\s+/g, " ")`);
check("season selector re-renders the overview", !!overviewAfter && overviewAfter !== overviewBefore, `${overviewBefore} -> ${overviewAfter}`);
await evaluate(`(() => { const sel = document.querySelector("#season-select"); sel.value = ${JSON.stringify(startSeason)}; sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await waitFor(`document.documentElement.dataset.route === "season/${startSeason}"`, "season restored");
await evaluate(`(() => { const sel = document.querySelector("#group-select"); if (!sel) return; if ([...sel.options].some((o) => o.value === ${JSON.stringify(startGroup)})) { sel.value = ${JSON.stringify(startGroup)}; sel.dispatchEvent(new Event("change", { bubbles: true })); } })()`);

await open("/standings");
await evaluate(`document.querySelector('th[data-key="team_name"]').click()`);
await sleep(120);
const sortedOnce = await evaluate(`[...document.querySelectorAll("#t-standings tbody tr")].map((tr) => tr.children[1].innerText).join(",")`);
await evaluate(`document.querySelector('th[data-key="team_name"]').click()`);
await sleep(120);
const sortedTwice = await evaluate(`[...document.querySelectorAll("#t-standings tbody tr")].map((tr) => tr.children[1].innerText).join(",")`);
check("sortable table headers toggle order", sortedOnce !== sortedTwice);
check("sort marker is rendered", /[▲▼]/.test(await evaluate(`document.querySelector('th[data-key="team_name"]').textContent`)));

await open("/players");
await evaluate(`(() => {
  const input = document.querySelector("#global-search");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "石文嫣");
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await waitFor(`document.querySelectorAll("#global-results a, #global-results [data-kind]").length > 0`, "search results");
check("global search returns matches", true, (await evaluate(`document.querySelectorAll("#global-results a, #global-results [data-kind]").length`)) + " hits");
await evaluate(`document.querySelector("#global-results a, #global-results [data-kind]").click()`);
await waitFor(`location.hash.startsWith("#/players/")`, "search result navigation");
check("search result opens the player page", true, await evaluate("location.hash"));

await evaluate(`document.querySelector("#theme-toggle").click()`);
await sleep(250);
check("theme toggle switches to light", (await evaluate("document.documentElement.dataset.theme")) === "light", await evaluate("getComputedStyle(document.body).backgroundColor"));
check("theme is persisted", (await evaluate(`localStorage.getItem("courtside-theme")`)) === "light");
check("theme-color meta follows the theme", (await evaluate(`document.querySelector("meta[name=theme-color]").content`)) !== "#101112", await evaluate(`document.querySelector("meta[name=theme-color]").content`));
await evaluate(`document.querySelector("#theme-toggle").click()`);

await open("/games/20863");
check("game detail renders box scores", (await evaluate(`document.querySelectorAll("table.data").length`)) >= 2);
const boxBefore = await evaluate(`[...document.querySelector('table[id^="t-box-"]').querySelectorAll("tbody tr")].map((tr) => tr.children[0].innerText).join(",")`);
await evaluate(`document.querySelector('table[id^="t-box-"] th[data-key="pts"]').click()`);
await sleep(120);
const boxAfter = await evaluate(`[...document.querySelector('table[id^="t-box-"]').querySelectorAll("tbody tr")].map((tr) => tr.children[0].innerText).join(",")`);
check("box-score columns sort independently", boxBefore !== boxAfter);

await open("/players/17864");
await waitFor(`document.querySelectorAll("#view svg").length > 0`, "player charts");
check("charts render inline SVG", true, (await evaluate(`document.querySelectorAll("#view svg").length`)) + " svg on the player page");

await open("/compare/p/17864/15202");
await waitFor(`document.querySelectorAll("#view table").length > 0`, "compare tables");
const compareText = await evaluate(`document.querySelector("#view").innerText`);
check("compare page renders both players", compareText.includes("何希言") && compareText.includes("石文嫣"));
check("compare page title names the pair", (await evaluate("document.title")).includes("何希言 vs 石文嫣"));

await setViewport(390, 844, true);
await open("/season/33");
check("mobile shell shows bottom nav and hides the tab rail",
  (await evaluate(`getComputedStyle(document.querySelector("#mobile-nav")).display`)) !== "none" &&
  (await evaluate(`getComputedStyle(document.querySelector("#tabs")).display`)) === "none");
const bottomBar = await evaluate(
  `[...document.querySelectorAll("#mobile-nav > button, #mobile-nav > details")].map((el) => el.querySelector("span").innerText.trim())`
);
check("six bottom-bar destinations, in Vic's order",
  JSON.stringify(bottomBar) === JSON.stringify(["Overview", "Standings", "Games", "Leaders", "Compare", "More"]),
  bottomBar.join(" · "));
await evaluate(`[...document.querySelectorAll("#mobile-nav [data-go]")].find((b) => b.dataset.go === "standings").click()`);
await waitFor(`location.hash.startsWith("#/standings")`, "mobile nav navigation");
check("mobile bottom nav navigates", true, await evaluate("location.hash"));
await evaluate(`[...document.querySelectorAll("#mobile-nav [data-go]")].find((b) => b.dataset.go === "leaders").click()`);
await waitFor(`location.hash.startsWith("#/leaders")`, "mobile Leaders navigation");
check("mobile Leaders tab navigates", true, await evaluate("location.hash"));
await evaluate(`[...document.querySelectorAll("#mobile-nav [data-go]")].find((b) => b.dataset.go === "compare").click()`);
await waitFor(`location.hash.startsWith("#/compare")`, "mobile Compare navigation");
check("mobile Compare tab navigates", true, await evaluate("location.hash"));
await evaluate(`document.querySelector("#more-nav").open = true`);
await sleep(100);
const moreItems = await evaluate(`[...document.querySelectorAll("#more-nav [data-go]")].map((b) => b.dataset.go)`);
check("More menu holds Teams and Players", JSON.stringify(moreItems) === JSON.stringify(["teams", "players"]), moreItems.join(", "));
await evaluate(`[...document.querySelectorAll("#more-nav [data-go]")].find((b) => b.dataset.go === "players").click()`);
await waitFor(`location.hash.startsWith("#/players")`, "mobile more-menu navigation");
check("mobile “More” menu reaches Players", true, await evaluate("location.hash"));

// The design's own acceptance test: the layout must not scroll sideways.
const ROUTES = ["/season/33", "/standings", "/teams", "/players", "/games", "/leaders", "/compare/p/17864/15202", "/players/17864", "/teams/1595", "/games/20863"];
const overflows = [];
for (const viewport of [{ w: 1440, h: 1000, m: false, name: "desktop" }, { w: 390, h: 844, m: true, name: "mobile" }]) {
  await setViewport(viewport.w, viewport.h, viewport.m);
  for (const route of ROUTES) {
    await open(route);
    const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    if (overflow > 1) overflows.push(`${viewport.name} ${route} +${overflow}px`);
  }
}
check("no horizontal overflow on any route", overflows.length === 0, overflows.join(", ") || "all " + ROUTES.length + " routes clean");

// Sticky header: the players table fits its card on a desktop, so the card must
// stop being a scroll box and the header must follow the window while scrolling.
await setViewport(1440, 1000, false);
await open("/players");
await evaluate("window.scrollTo(0, 0)");
await evaluate("window.scrollTo(0, 800)");
await sleep(250);
const stickyTop = await evaluate(
  `(() => { const th = document.querySelector("#t-players thead th"); return th ? Math.round(th.getBoundingClientRect().top) : null; })()`
);
check("players header sticks to the window while scrolling", stickyTop === 0, `header top ${stickyTop}`);

// Long names must not stretch the name column past the card (a group with long
// English names used to overflow the page once the scroll box was removed).
await setViewport(1440, 1000, false);
await open("/players?season=33&group=11");
await waitFor(`document.querySelector("#group-select")?.value === "11"`, "group 11 picked");
const longNameDesktop = await evaluate(
  `(() => { const t = document.querySelector("#t-players"); return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: [...t.querySelectorAll("a.nm")].filter(a => a.scrollWidth > a.clientWidth + 1).length }; })()`
);
check("long-name group keeps the page width", longNameDesktop.overflow <= 1, `${longNameDesktop.overflow}px overflow`);

await setViewport(390, 844, true);
await open("/players?season=33&group=11");
await waitFor(`document.querySelector("#group-select")?.value === "11"`, "group 11 picked on mobile");
const longNameMobile = await evaluate(
  `(() => { const t = document.querySelector("#t-players"); return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clamped: [...t.querySelectorAll("a.nm")].filter(a => a.scrollWidth > a.clientWidth + 1).length }; })()`
);
check(
  "long player names are ellipsized on a phone",
  longNameMobile.clamped >= 1 && longNameMobile.overflow <= 1,
  `${longNameMobile.clamped} clamped, ${longNameMobile.overflow}px overflow`
);

// Widening tables keep their card scroll box on a phone (which traps
// `position: sticky`), so SortTable mirrors the header into a fixed strip.
// The strip must sit at the top, line up with the real header, and add no
// horizontal page overflow.
const pinStrip = (tableSel) => `(() => {
  const pin = document.querySelector(".thead-pin.on");
  const table = document.querySelector(${JSON.stringify(tableSel)});
  if (!pin || !table) return { on: false };
  const lefts = (els) => els.map((el) => Math.round(el.getBoundingClientRect().left));
  const pinLefts = lefts([...pin.querySelectorAll("thead th")]);
  const thLefts = lefts([...table.tHead.rows[0].cells]);
  // Border-collapse distributes the column widths with sub-pixel rounding, so
  // "aligned" allows one pixel of drift at the far end of wide tables.
  const aligned =
    pinLefts.length === thLefts.length && Math.max(0, ...pinLefts.map((left, i) => Math.abs(left - thLefts[i]))) <= 1;
  return {
    on: true,
    top: Math.round(pin.getBoundingClientRect().top),
    aligned,
    pinCount: pinLefts.length,
    thCount: thLefts.length,
    delta: Math.round(Math.max(0, ...pinLefts.map((left, i) => Math.abs(left - thLefts[i]))) * 100) / 100,
    pinLefts: pinLefts.slice(0, 3), thLefts: thLefts.slice(0, 3),
    cardScrollLeft: Math.round(table.closest(".card").scrollLeft), pinScrollLeft: Math.round(pin.querySelector(".thead-pin-scroll").scrollLeft),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;
await setViewport(390, 844, true);
await open("/players?season=33&group=11");
await waitFor(`document.querySelector("#group-select")?.value === "11"`, "group 11 picked on mobile");
// The phone table defaults to five columns, which fit — the pinned header only
// exists once "Advanced stats" makes the table wider than its card.
await evaluate(`document.querySelector(".table-cols-toggle").click()`);
await waitFor(`document.querySelector(".table-cols-toggle").getAttribute("aria-expanded") === "true"`, "advanced stats open");
await sleep(250);
await evaluate("window.scrollTo(0, 700)");
await sleep(300);
const phonePin = await evaluate(pinStrip("#t-players"));
check("players header pins to the top on a phone", phonePin.on && phonePin.top === 0 && phonePin.aligned && phonePin.overflow <= 1, `top ${phonePin.top}, aligned ${phonePin.aligned} (${phonePin.pinCount}/${phonePin.thCount} cols, ${phonePin.delta}px drift, card ${phonePin.cardScrollLeft}, pin ${phonePin.pinScrollLeft}, ${JSON.stringify(phonePin.pinLefts)} vs ${JSON.stringify(phonePin.thLefts)}), ${phonePin.overflow}px overflow`);

await open("/games/20863");
await waitFor(`!!document.querySelector("#t-box-1595")`, "game box score rendered");
await evaluate(`document.querySelector('[aria-controls="t-box-1595"]').click()`);
await waitFor(`document.querySelector('[aria-controls="t-box-1595"]').getAttribute("aria-expanded") === "true"`, "full box score open");
await sleep(250);
await evaluate("window.scrollTo(0, 1500)");
await sleep(300);
const gamePin = await evaluate(pinStrip("#t-box-1595"));
check("game box-score header pins to the top on a phone", gamePin.on && gamePin.top === 0 && gamePin.aligned && gamePin.overflow <= 1, `top ${gamePin.top}, aligned ${gamePin.aligned}, ${gamePin.overflow}px overflow`);

// Season picker: on a desktop the label is shortened ("33 · 第33屆驍籃") and the
// box is narrower than the Group box, which keeps the long group names readable.
await setViewport(1440, 1000, false);
await open("/standings");
const pickers = await evaluate(`(() => {
  const s = document.querySelector("#season-select");
  const g = document.querySelector("#group-select");
  return {
    text: s.options[s.selectedIndex].text,
    full: s.title,
    seasonW: Math.round(s.getBoundingClientRect().width),
    groupW: Math.round(g.getBoundingClientRect().width),
  };
})()`);
check("season picker shows the short label", pickers.text === "33 · 第33屆驍籃" && !pickers.text.includes("青少年"), `${pickers.text} (title: ${pickers.full})`);
check("group picker keeps the wider box on desktop", pickers.groupW > pickers.seasonW + 20, `season ${pickers.seasonW}px / group ${pickers.groupW}px`);

// Compact phone header (UX-14): brand+theme row and search+filter row, so the
// header costs ~113 px instead of the design's 243 px.
await setViewport(390, 844, true);
await open("/season/33");
const phoneHeader = await evaluate(`(() => {
  const h = document.querySelector(".topbar");
  const chip = document.querySelector("#filter-toggle");
  return { height: Math.round(h.getBoundingClientRect().height), chip: chip ? chip.innerText.replace(/\\s+/g, " ").trim() : null, compact: h.classList.contains("compact") };
})()`);
check("phone header is compact and under 130 px", phoneHeader.compact && phoneHeader.height <= 130, `${phoneHeader.height}px header`);
check("phone filter chip names the season scope", /S33/.test(phoneHeader.chip || "") && /(U13|All groups)/.test(phoneHeader.chip || ""), phoneHeader.chip || "missing");
await evaluate(`document.querySelector("#filter-toggle").click()`);
await waitFor(`!document.querySelector("#filter-panel").hidden`, "filter panel");
check("phone filter panel opens on tap", true, await evaluate(`document.querySelector("#filter-panel").getBoundingClientRect().height + "px panel"`));

// Changing group from the phone panel updates the chip, then closes itself.
// The season overview deliberately has no group picker (m02206), so this runs
// on a group-scoped page.
await open("/standings");
// The previous check may have left the panel open; normalise, then open it.
if (await evaluate(`!document.querySelector("#filter-panel").hidden`)) {
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await waitFor(`document.querySelector("#filter-panel").hidden`, "filter panel reset");
}
await evaluate(`document.querySelector("#filter-toggle").click()`);
await waitFor(`!document.querySelector("#filter-panel").hidden`, "filter panel on standings");
await evaluate(`(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  const sel = document.querySelector("#group-select");
  set.call(sel, "11");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
await waitFor(`/U11/.test(document.querySelector("#filter-toggle").innerText)`, "filter chip follows the group");
check("phone filter panel applies a group and closes",
  (await evaluate(`document.querySelector("#filter-panel").hidden`)) === true,
  await evaluate(`document.querySelector("#filter-toggle").innerText.replace(/\\s+/g, " ").trim()`));

// Escape closes the disclosure (reopen first).
await evaluate(`document.querySelector("#filter-toggle").click()`);
await waitFor(`!document.querySelector("#filter-panel").hidden`, "filter panel reopened");
await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
await sleep(150);
check("Escape closes the phone filter panel", (await evaluate(`document.querySelector("#filter-panel").hidden`)) === true);

// ------------------------------------------------ UX audit pass (2026-10-19)
// UX-01 (owner decision, 2026-10-19): the season overview covers EVERY group in
// the season. It is not bound to the header's group picker; group pages are.
await setViewport(390, 844, true);
await open("/season/33");
const scope = await evaluate(`(() => ({
  eyebrow: document.querySelector(".scope-eyebrow")?.innerText.trim(),
  latest: (document.querySelector(".results")?.innerText || "").replace(/\\s+/g, " "),
  current: document.querySelectorAll(".season-card[aria-current='true']").length,
  cards: document.querySelectorAll(".season-card").length,
  stats: (document.querySelector(".season-stats")?.innerText || "").replace(/\\s+/g, " "),
  chip: (document.querySelector("#filter-toggle")?.innerText || "").replace(/\\s+/g, " ").trim(),
  groupSelect: !!document.querySelector("#group-select"),
}))()`);
check("season overview is labelled as all groups", scope.eyebrow === "ALL GROUPS · SEASON 33", scope.eyebrow);
check("season overview totals cover the whole season", /7\s*group/i.test(scope.stats) && /24\s*teams/i.test(scope.stats) && /6\s*games/i.test(scope.stats) && /5\s*played/i.test(scope.stats), scope.stats);
check("season overview mixes results from every group", scope.latest.includes("培正G u9") && scope.latest.includes("Arouse U13"), scope.latest.slice(0, 90));
check("season overview lists every group without marking one current", scope.cards === 7 && scope.current === 0, `${scope.cards} cards, ${scope.current} current`);
check("phone header names the all-groups scope and hides the group picker", /All groups/.test(scope.chip) && !scope.groupSelect, scope.chip);

// Desktop: the group picker is replaced by a static marker, so the control can
// never suggest that the overview is filtered.
await setViewport(1440, 1000, false);
await open("/season/33");
const scopeDesk = await evaluate(`({
  groupSelect: !!document.querySelector("#group-select"),
  pill: (document.querySelector(".all-groups-pill")?.innerText || "").trim(),
  meta: (document.querySelector("#meta-line")?.innerText || "").trim(),
})`);
check("desktop overview swaps the group picker for an All groups marker", !scopeDesk.groupSelect && /all groups/i.test(scopeDesk.pill) && /All groups/.test(scopeDesk.meta), `${scopeDesk.pill} / ${scopeDesk.meta}`);
await setViewport(390, 844, true);
await open("/season/33");

// UX-03: groups with no played games must not show a fabricated leader.
const cards = await evaluate(`(() => {
  const all = [...document.querySelectorAll(".season-card")];
  const withFakeLeader = all.filter((c) => c.innerText.includes("LEADING TEAM") && /0W · 0L/.test(c.innerText));
  return {
    cards: all.length,
    fakeLeaders: withFakeLeader.length,
    noGames: all.filter((c) => c.innerText.includes("No games played yet")).length,
    noTeams: all.filter((c) => c.innerText.includes("No teams entered yet")).length,
  };
})()`);
check("group cards hide leaders for groups that have not played", cards.fakeLeaders === 0 && cards.noGames >= 2 && cards.noTeams >= 1, `${cards.fakeLeaders} fake leaders, ${cards.noGames} no-games, ${cards.noTeams} no-teams`);

// UX-02: fixtures without a score are labelled, never rendered as 0 – 0.
await open("/games?season=33&group=16");
const statuses = await evaluate(`(() => ({
  final: document.querySelectorAll('[data-status="final"]').length,
  skipped: document.querySelectorAll('[data-status="skipped"]').length,
  skippedText: document.querySelector('[data-status="skipped"]')?.innerText.trim(),
  pageText: document.querySelector("#view").innerText.replace(/\\s+/g, " "),
  rows: [...document.querySelectorAll("#t-games tbody tr")].map((r) => r.innerText.replace(/\\s+/g, " ")),
}))()`);
check("past fixtures without a score are marked Skipped", statuses.skipped === 1 && /^skipped$/i.test(statuses.skippedText || ""), statuses.skippedText);
check("no Results pending wording survives anywhere", !/result pending/i.test(statuses.pageText) && !/\\bpending\\b/i.test(statuses.pageText), statuses.pageText.includes("pending") ? "found 'pending'" : "no pending wording");
check("a skipped fixture never shows a 0 score", statuses.final === 1 && !statuses.rows.some((r) => /Arouse U13\\s+0/.test(r)), statuses.rows.join(" | ").slice(0, 90));

// UX-03: empty groups explain themselves instead of showing all-zero tables.
await open("/standings?season=33&group=28");
const zeroTable = await evaluate(`({ text: document.querySelector("#view").innerText.replace(/\\s+/g, " "), bars: document.querySelectorAll(".bar-row").length })`);
check("standings explain an empty group instead of a zero chart", zeroTable.text.includes("No games played yet") && zeroTable.bars === 0, `${zeroTable.bars} bar rows`);
await open("/leaders?season=33&group=26");
const zeroLeaders = await evaluate(`({ text: document.querySelector("#view").innerText.replace(/\\s+/g, " "), tables: document.querySelectorAll("#view table.data").length })`);
check("leaders explain an empty group instead of zero tables", zeroLeaders.text.includes("No games played yet") && zeroLeaders.text.includes("View fixtures") && zeroLeaders.tables === 0, zeroLeaders.tables + " tables");

// UX-04: search ranks the current group first and labels the scope.
await open("/season/33?season=33&group=16");
await evaluate(`(() => {
  const input = document.querySelector("#global-search");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(input, "Arouse");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
})()`);
await sleep(400);
const search = await evaluate(`(() => ({
  first: document.querySelector("#global-results a")?.getAttribute("href") || "",
  text: (document.querySelector("#global-results")?.innerText || "").replace(/\\s+/g, " "),
  count: document.querySelectorAll("#global-results a").length,
}))()`);
check("search ranks the current group first", search.first.includes("teams/1595"), search.first);
check("search labels result scope and caps the list", /THIS GROUP/i.test(search.text) && /OTHER SEASONS/i.test(search.text) && search.count <= 30, `${search.count} hits`);
await evaluate(`document.querySelector("#global-search").blur()`);

// UX-21 / UX-05: phone tables default to a compact readable column set and can
// be expanded on demand; the disclosure is a full-height tap target.
await open("/players?season=33&group=11");
const phoneCols = await evaluate(`(() => {
  const ths = [...document.querySelectorAll("#t-players thead th")];
  const toggle = document.querySelector(".table-cols-toggle");
  return {
    visible: ths.filter((th) => th.getClientRects().length > 0).length,
    total: ths.length,
    toggleH: toggle ? Math.round(toggle.getBoundingClientRect().height) : 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
check("phone players table hides optional columns by default", phoneCols.visible >= 4 && phoneCols.visible <= 8 && phoneCols.overflow <= 1, phoneCols.visible + " of " + phoneCols.total + " columns visible");
check("phone column toggle is a 44 px disclosure", phoneCols.toggleH >= 44, phoneCols.toggleH + "px");
await evaluate(`document.querySelector(".table-cols-toggle").click()`);
await waitFor(`document.querySelector("#t-players").closest(".card").classList.contains("scrollable")`, "expanded table becomes scrollable");
check("expanded phone table says that it scrolls", (await evaluate(`(() => { const hint = document.querySelector(".table-scroll-hint"); return !!hint && getComputedStyle(hint).display !== "none" && hint.innerText.includes("Swipe"); })()`)) === true);

// UX-05 / UX-21: standings on a phone keeps Points visible, and long club names
// must never push the card (or the page) into a sideways scroll.
await setViewport(320, 640, true);
await open("/standings?season=33&group=11");
const phoneSt = await evaluate(`(() => {
  const ths = [...document.querySelectorAll("#t-standings thead th")];
  const card = document.querySelector("#st-table").closest(".card");
  return {
    visible: ths.filter((th) => th.getClientRects().length > 0).map((th) => th.innerText.trim()),
    total: ths.length,
    cardOverflow: card.scrollWidth - card.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
check("phone standings keeps points visible without sideways scroll", phoneSt.visible.some((t) => /^pts$/i.test(t)) && phoneSt.visible.length <= 6 && phoneSt.cardOverflow <= 1 && phoneSt.pageOverflow <= 1, `${phoneSt.visible.join(",")} / card ${phoneSt.cardOverflow}px / page ${phoneSt.pageOverflow}px`);
await evaluate(`document.querySelector(".table-cols-toggle").click()`);
await sleep(150);
const expandedSt = await evaluate(`(() => { const ths = [...document.querySelectorAll("#t-standings thead th")]; return ths.filter((th) => th.getClientRects().length > 0).length; })()`);
check("phone standings disclosure reveals every column", expandedSt === phoneSt.total, `${expandedSt}/${phoneSt.total}`);
await evaluate(`document.querySelector(".table-cols-toggle").click()`);
await sleep(100);
for (const w of [375, 390]) {
  await setViewport(w, 700, true);
  await open("/season/33");
  await open("/standings?season=33&group=11");
  const m = await evaluate(`(() => { const card = document.querySelector("#st-table").closest(".card"); return { card: card.scrollWidth - card.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
  check(`standings fit a ${w} px phone with long club names`, m.card <= 1 && m.page <= 1, `card ${m.card}px / page ${m.page}px`);
}

// Teams: same phone budget — PF/PA and the staff columns sit behind the
// "Full stats" disclosure, so the table never scrolls sideways on a phone.
await setViewport(320, 640, true);
await open("/season/33");
await open("/teams?season=33&group=11");
const phoneTeams = await evaluate(`(() => {
  const ths = [...document.querySelectorAll("#t-teams thead th")];
  const card = document.querySelector("#teams-table").closest(".card");
  return {
    visible: ths.filter((th) => th.getClientRects().length > 0).map((th) => th.innerText.trim()),
    total: ths.length,
    cardOverflow: card.scrollWidth - card.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
check("phone teams table fits without sideways scroll", phoneTeams.visible.length >= 4 && phoneTeams.visible.length <= 6 && phoneTeams.cardOverflow <= 1 && phoneTeams.pageOverflow <= 1, `${phoneTeams.visible.join(",")} / card ${phoneTeams.cardOverflow}px`);
await evaluate(`document.querySelector(".table-cols-toggle").click()`);
await sleep(150);
const expandedTeams = await evaluate(`(() => { const ths = [...document.querySelectorAll("#t-teams thead th")]; return ths.filter((th) => th.getClientRects().length > 0).length; })()`);
check("phone teams disclosure reveals the full table", expandedTeams === phoneTeams.total, `${expandedTeams}/${phoneTeams.total}`);
await evaluate(`document.querySelector(".table-cols-toggle").click()`);

// aria-sort must describe the active sort both ways.
await setViewport(1440, 1000, false);
await open("/players");
await evaluate(`document.querySelector("#t-players thead th[data-key]").click()`);
await sleep(200);
const ariaSort = await evaluate(`(() => {
  const ths = [...document.querySelectorAll("#t-players thead th")];
  return {
    active: ths.filter((th) => th.getAttribute("aria-sort") === "ascending" || th.getAttribute("aria-sort") === "descending").length,
    none: ths.filter((th) => th.getAttribute("aria-sort") === "none").length,
  };
})()`);
check("sortable headers expose aria-sort", ariaSort.active === 1 && ariaSort.none >= 5, `${ariaSort.active} active / ${ariaSort.none} none`);

// UX-18: comparison content must fit a 320 px phone without panning.
await setViewport(320, 568, true);
await open("/compare/p/17864/15202?season=33&group=16"); // the pair lives in group 16
await waitFor(`!!document.querySelector(".cmp-table")`, "comparison table");
await sleep(150);
const compareNarrow = await evaluate(`(() => {
  const table = document.querySelector(".cmp-table");
  const card = table?.closest(".card");
  const content = card ? card.clientWidth - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight) : 0;
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tableW: table ? Math.round(table.getBoundingClientRect().width) : 0,
    content: Math.round(content),
  };
})()`);
check("comparison fits a 320 px phone", compareNarrow.overflow <= 1 && compareNarrow.tableW <= compareNarrow.content + 1, `${compareNarrow.tableW}px table in ${compareNarrow.content}px card`);

// A season link in the path must move the header pickers with it.
await setViewport(390, 844, true);
await open("/season/31");
check("direct season link updates the header pickers", (await evaluate(`document.querySelector("#filter-toggle").innerText`)).includes("S31"), await evaluate(`document.querySelector("#filter-toggle").innerText.replace(/\\s+/g, " ").trim()`));

// UX-21 acceptance: nothing may scroll sideways at the narrowest supported width.
const narrowOverflows = [];
for (const route of ROUTES) {
  await open(route);
  const width = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  if (width > 1) narrowOverflows.push(`${route} +${width}px`);
}
check("no horizontal overflow at 320 px", narrowOverflows.length === 0, narrowOverflows.join(", ") || "all " + ROUTES.length + " routes clean");

check("no uncaught page exceptions", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 400));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed`);
ws.close();
try { chrome.kill(); } catch {}
try { preview?.kill("SIGTERM"); } catch {}
process.exit(failed.length ? 1 : 0);
