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
const overviewBefore = await evaluate(`document.querySelector("#view .results")?.innerText.replace(/\\s+/g, " ")`);
const switchedTo = await evaluate(`(() => {
  const sel = document.querySelector("#season-select");
  const other = [...sel.options].map((o) => o.value).find((v) => v !== sel.value);
  sel.value = other;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return other;
})()`);
await waitFor(`document.documentElement.dataset.route === "season/${switchedTo}"`, "season switch route");
await sleep(150);
const overviewAfter = await evaluate(`document.querySelector("#view .results")?.innerText.replace(/\\s+/g, " ")`);
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

// Phone header (owner decision, 2026-10-19): the season and group pickers stay
// visible side by side — no popup — so one selection changes the scope.
await setViewport(390, 844, true);
await open("/standings");
const phoneHeader = await evaluate(`(() => {
  const h = document.querySelector(".topbar");
  const selects = [...document.querySelectorAll(".controls select")];
  return {
    height: Math.round(h.getBoundingClientRect().height),
    compact: h.classList.contains("compact"),
    popup: !!document.querySelector("#filter-toggle") || !!document.querySelector("#filter-panel"),
    selects: selects.map((s) => ({
      id: s.id,
      h: Math.round(s.getBoundingClientRect().height),
      w: Math.round(s.getBoundingClientRect().width),
      label: (s.selectedOptions[0] ? s.selectedOptions[0].innerText : "").trim(),
    })),
  };
})()`);
check("phone header is compact and under 200 px", phoneHeader.compact && phoneHeader.height <= 200, `${phoneHeader.height}px header`);
check("phone header shows both pickers without a popup",
  !phoneHeader.popup && phoneHeader.selects.length === 2 && phoneHeader.selects.every((s) => s.h >= 44),
  phoneHeader.selects.map((s) => `${s.id} ${s.w}px "${s.label}"`).join(", "));
check("phone group label keeps ‘GIRLS’", /GIRLS/i.test(phoneHeader.selects[1]?.label || ""), phoneHeader.selects[1]?.label || "missing");

// One change applies immediately: no panel, no Apply button.
await evaluate(`(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  const sel = document.querySelector("#group-select");
  set.call(sel, "11");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
await waitFor(`/U11/.test(document.querySelector(".eyebrow").innerText)`, "group applies");
check("phone group picker applies on a single change", true, await evaluate(`document.querySelector(".eyebrow").innerText.trim()`));

// ------------------------------------------------ UX audit pass (2026-10-19)
// UX-01 (owner decision, 2026-10-19): the season overview covers EVERY group in
// the season. It is not bound to the header's group picker; group pages are.
await setViewport(390, 844, true);
await open("/season/33");
const scope = await evaluate(`(() => ({
  latest: (document.querySelector(".results")?.innerText || "").replace(/\\s+/g, " "),
  current: document.querySelectorAll(".season-card[aria-current='true']").length,
  cards: document.querySelectorAll(".season-card").length,
  hero: !!document.querySelector(".scope-head") || !!document.querySelector(".season-stats"),
  pill: (document.querySelector(".all-groups-pill")?.innerText || "").replace(/\\s+/g, " ").trim(),
  groupSelect: !!document.querySelector("#group-select"),
  h2: document.querySelector("#view h2.sr-only")?.innerText.trim() || "",
}))()`);
check("season overview drops the duplicate hero and totals strip", scope.hero === false, `hero ${scope.hero}, ${scope.cards} cards`);
check("season overview keeps an accessible heading", /第33屆驍籃青少年籃球聯賽 overview/.test(scope.h2), scope.h2);
check("season overview mixes results from every group", scope.latest.includes("培正G u9") && scope.latest.includes("Arouse U13"), scope.latest.slice(0, 90));
check("season overview lists every group without marking one current", scope.cards === 7 && scope.current === 0, `${scope.cards} cards, ${scope.current} current`);
check("phone header names the all-groups scope and hides the group picker", /all groups/i.test(scope.pill) && !scope.groupSelect, scope.pill);

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
await open("/games");
const gamesOrder = await evaluate(`(() => {
  const rows = [...document.querySelectorAll("#t-games tbody tr")];
  const dates = rows.map((r) => r.querySelector("time")?.getAttribute("datetime") || "");
  return {
    first: dates[0] || "",
    last: dates[dates.length - 1] || "",
    count: dates.length,
    sorted: dates.every((d, i) => i === 0 || dates[i - 1] >= d),
  };
})()`);
check("games are listed newest first", gamesOrder.count > 1 && gamesOrder.sorted && gamesOrder.first >= gamesOrder.last, `${gamesOrder.first} … ${gamesOrder.last}`);

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
check("direct season link updates the header pickers", (await evaluate(`document.querySelector("#season-select").value`)) === "31", await evaluate(`document.querySelector("#season-select").selectedOptions[0].innerText.trim()`));

// UX-21 acceptance: nothing may scroll sideways at the narrowest supported width.
const narrowOverflows = [];
for (const route of ROUTES) {
  await open(route);
  const width = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  if (width > 1) narrowOverflows.push(`${route} +${width}px`);
}
check("no horizontal overflow at 320 px", narrowOverflows.length === 0, narrowOverflows.join(", ") || "all " + ROUTES.length + " routes clean");

// ------------------------------------------ Medium UX items (2026-10-19)
// UX-11: sortable headers keep their columnheader semantics (a role="button"
// on <th> would erase them), stay focusable and carry aria-sort.
await setViewport(1440, 1000, false);
await open("/players");
const sortSemantics = await evaluate(`(() => {
  const table = document.querySelector("#t-players");
  const ths = [...table.querySelectorAll("thead th")];
  return {
    buttonRoles: table.querySelectorAll("thead th[role='button']").length,
    scopes: ths.every((th) => th.scope === "col"),
    label: ths[0].getAttribute("aria-label") || "",
    sort: ths[0].getAttribute("aria-sort") || "",
  };
})()`);
check("sort headers keep column semantics", sortSemantics.buttonRoles === 0 && sortSemantics.scopes && /^Sort by /.test(sortSemantics.label) && sortSemantics.sort === "none", `${sortSemantics.label} / ${sortSemantics.sort}`);

// UX-09: percentages keep their percent sign and averages keep one decimal.
const formatting = await evaluate(`(() => {
  const headers = [...document.querySelectorAll("#t-players thead th")].map((th) => th.textContent.replace(/[▲▼]/g, "").trim());
  const col = (name) => headers.indexOf(name);
  const cells = (idx) => [...document.querySelectorAll("#t-players tbody tr")].map((tr) => (tr.children[idx]?.textContent || "").trim());
  const fg = cells(col("FG%"));
  const ppg = cells(col("PPG"));
  const pts = cells(col("PTS"));
  return {
    fg: fg.slice(0, 3),
    ppg: ppg.slice(0, 3),
    pts: pts.slice(0, 3),
    fgOk: fg.length > 0 && fg.every((c) => c === "—" || c.endsWith("%")),
    ppgOk: ppg.length > 0 && ppg.every((c) => c === "—" || (c.includes(".") && c.split(".")[1].length === 1 && !isNaN(Number(c)))),
    ptsOk: pts.length > 0 && pts.every((c) => c === "—" || /^[0-9]+$/.test(c)),
  };
})()`);
check("percentage columns carry a percent sign", formatting.fgOk, formatting.fg.join(" "));
check("per-game averages use one decimal, totals stay whole", formatting.ppgOk && formatting.ptsOk, `PPG ${formatting.ppg.join(" ")} · PTS ${formatting.pts.join(" ")}`);

// UX-07: one native-disclosure stat guide per stats view.
const guideBefore = await evaluate(`(() => { const d = document.querySelector("#view .stat-guide"); return { exists: !!d, open: d ? d.open : false }; })()`);
await evaluate(`(() => { const d = document.querySelector("#view .stat-guide"); d.querySelector("summary").click(); })()`);
await sleep(120);
const guideAfter = await evaluate(`(() => { const d = document.querySelector("#view .stat-guide"); return { open: d.open, text: (d.innerText || "").replace(/\s+/g, " ") }; })()`);
check("stat guide is an expandable disclosure", guideBefore.exists && guideBefore.open === false && guideAfter.open === true);
check("stat guide defines eFG%, TS% and the per-game convention", /eFG%/.test(guideAfter.text) && /TS%/.test(guideAfter.text) && /per game/i.test(guideAfter.text), guideAfter.text.slice(0, 120));

// UX-08: the same measure uses STL/BLK for totals, SPG/BPG for averages.
await open("/players/17864");
const detailLabels = await evaluate(`(() => {
  const chips = [...document.querySelectorAll("#view .qstrip .q span")].map((s) => s.textContent.trim());
  const tableHeaders = [...document.querySelectorAll("#view table.data thead th")].map((th) => th.textContent.replace(/[▲▼]/g, "").trim());
  return { chips, tableHeaders };
})()`);
check("player totals label steals/blocks as STL/BLK", detailLabels.chips.includes("STL") && detailLabels.chips.includes("BLK"), detailLabels.chips.join(","));
check("player game log uses STL/BLK", detailLabels.tableHeaders.includes("STL") && detailLabels.tableHeaders.includes("BLK"), detailLabels.tableHeaders.slice(8, 13).join(","));

await open("/games/20863");
const boxHeaders = await evaluate(`([...document.querySelectorAll('#view table.data thead th')].map((th) => th.textContent.replace(/[▲▼]/g, "").trim()))`);
check("box score uses STL/BLK", boxHeaders.includes("STL") && boxHeaders.includes("BLK"), boxHeaders.filter((h) => /ST|BLK/.test(h)).join(","));

// UX-06: the points chart pairs scored/conceded bars and names the pattern.
await setViewport(1440, 1000, false);
await open("/standings");
const chart = await evaluate(`(() => {
  const card = document.querySelector(".pfpa-card");
  const rows = [...card.querySelectorAll(".pfpa-row")];
  const legend = card.querySelector(".pfpa-legend").textContent.split("\\n").map((s) => s.trim()).filter(Boolean).join(" ");
  return {
    title: card.querySelector("h3").textContent.trim(),
    legend,
    rows: rows.length,
    fills: card.querySelectorAll(".pfpa-fill").length,
    emptyRows: card.querySelectorAll(".pfpa-none").length,
    srCaption: (card.querySelector(".sr-only caption") || {}).textContent || "",
    oldBars: document.querySelectorAll(".bar-row").length,
  };
})()`);
check("points chart pairs scored and conceded bars", chart.title === "Points scored vs conceded" && chart.legend.includes("PF points scored") && chart.legend.includes("PA points conceded") && chart.fills % 2 === 0 && chart.fills / 2 + chart.emptyRows === chart.rows && /PF/.test(chart.srCaption) && chart.oldBars === 0, `${chart.rows} rows / ${chart.fills} fills / ${chart.emptyRows} empty`);

// UX-19: a group with no games explains itself instead of showing empty cards.
await open("/standings?season=33&group=28");
const emptyStandings = await evaluate(`(() => {
  const empty = document.querySelector("#view .scope-empty");
  return {
    exists: !!empty,
    title: empty ? empty.querySelector(".scope-empty-title").textContent.trim() : "",
    link: empty && empty.querySelector("a") ? empty.querySelector("a").getAttribute("href") : "",
    rows: document.querySelectorAll("#view .pfpa-row").length,
  };
})()`);
check("standings with no games explains the empty state", emptyStandings.exists && /no games/i.test(emptyStandings.title) && emptyStandings.link.includes("#/games") && emptyStandings.rows === 0, emptyStandings.title);

// UX-10: comparison pickers are labelled and options carry team context.
await open("/compare?season=33&group=16");
const cmpLabels = await evaluate(`(() => {
  const sels = [...document.querySelectorAll("#view .compare-pickers select")];
  const opt = (sels[2] ? [...sels[2].options].map((o) => o.textContent.trim()).find((o) => o !== "— choose —") : "") || "";
  return {
    labels: sels.map((s) => (s.labels && s.labels[0] ? s.labels[0].textContent.trim() : "")),
    opt,
    empty: (document.querySelector("#view .cmp-empty") || {}).textContent ? document.querySelector("#view .cmp-empty").textContent.split("\\n").map((s) => s.trim()).filter(Boolean).join(" ") : "",
  };
})()`);
check("comparison pickers are labelled", cmpLabels.labels.join(",") === "Compare,First player,Second player" && cmpLabels.opt.includes("("), cmpLabels.labels.join(","));
check("comparison explains that both sides are required", /Both sides are required/i.test(cmpLabels.empty), cmpLabels.empty.slice(0, 80));

// UX-18: advanced metrics live behind a disclosure that still fits 320 px.
await setViewport(320, 568, true);
await open("/compare/p/17864/15202?season=33&group=16");
const advanced = await evaluate(`(() => {
  const d = document.querySelector("#view details.cmp-advanced");
  const t = d ? d.querySelector("table") : null;
  return {
    exists: !!d,
    closed: d ? !d.open : false,
    tableW: t ? Math.round(t.getBoundingClientRect().width) : 0,
    contentW: d ? Math.round(d.closest(".card").clientWidth) : 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
check("comparison keeps advanced metrics behind a disclosure", advanced.exists && advanced.closed && advanced.tableW > 0 && advanced.tableW <= advanced.contentW + 1 && advanced.overflow === 0, `${advanced.tableW}/${advanced.contentW}px`);
await evaluate(`document.querySelector("#view details.cmp-advanced summary").click()`);
await sleep(150);
const advRows = await evaluate(`document.querySelectorAll("#view details.cmp-advanced table tbody tr").length`);
check("advanced comparison disclosure opens 11 metrics", advRows === 11, `${advRows} rows`);

// UX-17: leaders get a category jump strip that marks the current category.
await setViewport(1440, 1000, false);
await open("/leaders");
const jump = await evaluate(`(() => {
  const chips = [...document.querySelectorAll(".leader-jump .leader-chip")];
  return {
    count: chips.length,
    current: chips.filter((c) => c.getAttribute("aria-current") === "true").length,
    height: chips.length ? Math.round(chips[0].getBoundingClientRect().height) : 0,
    last: chips.length ? chips[chips.length - 1].textContent.trim() : "",
  };
})()`);
check("leaders expose a category jump strip", jump.count === 8 && jump.current === 1 && jump.height >= 32, `${jump.count} chips`);
await evaluate(`document.querySelector(".leader-jump .leader-chip:last-child").click()`);
await sleep(400);
const jumped = await evaluate(`(() => {
  const c = [...document.querySelectorAll(".leader-jump .leader-chip")].find((x) => x.getAttribute("aria-current") === "true");
  return { label: c ? c.textContent.trim() : "", current: document.querySelectorAll(".leader-jump .leader-chip[aria-current='true']").length };
})()`);
check("category chip marks itself after a jump", jumped.current === 1 && jumped.label.length > 0 && jumped.label !== jump.last.replace("✓", "").trim(), jumped.label);

// UX-12/16: six phone nav labels stay readable and unclipped at 320 px.
await setViewport(320, 700, true);
await open("/standings");
const nav = await evaluate(`(() => {
  const labels = [...document.querySelectorAll("#mobile-nav .nav-label")].slice(0, 6).map((el) => ({
    text: el.textContent.trim(),
    size: parseFloat(getComputedStyle(el).fontSize),
    clip: el.scrollWidth - el.clientWidth,
  }));
  return { labels, navH: Math.round(document.querySelector("#mobile-nav").getBoundingClientRect().height) };
})()`);
check("phone nav labels are readable and unclipped", nav.labels.map((l) => l.text).join(",") === "Overview,Standings,Games,Leaders,Compare,More" && nav.labels.every((l) => l.size >= 9.5) && nav.labels.every((l) => l.clip <= 1) && nav.navH <= 70, nav.labels.map((l) => `${l.text} ${l.size}px`).join(" "));

// UX-12: the More tab marks itself while a nested page (teams/players) is open.
await open("/players");
const more = await evaluate(`(() => {
  const details = document.querySelector("#mobile-nav details");
  return {
    current: details ? details.querySelector("summary").getAttribute("aria-current") : null,
    dot: details && details.querySelector(".nav-dot") ? details.querySelector(".nav-dot").dataset.visible : null,
  };
})()`);
check("More marks itself on nested pages", more.current === "page" && more.dot === "true", `aria-current=${more.current} dot=${more.dot}`);

// UX-20: on a phone the search opens a full sheet with a 44 px close.
await open("/standings");
await evaluate(`document.querySelector("#global-search").click()`);
await sleep(320);
const sheet = await evaluate(`(() => {
  const input = document.querySelector("#global-search");
  const wrap = input.closest(".gsearch");
  const close = document.querySelector(".gs-close");
  const r = close ? close.getBoundingClientRect() : { width: 0, height: 0 };
  return {
    surface: wrap.classList.contains("gsearch-surface"),
    expanded: input.getAttribute("aria-expanded"),
    closeW: Math.round(r.width),
    closeH: Math.round(r.height),
  };
})()`);
check("phone search opens a full sheet with a 44 px close", sheet.surface && sheet.expanded === "true" && sheet.closeW >= 44 && sheet.closeH >= 44, `${sheet.closeW}x${sheet.closeH}`);
await evaluate(`(() => {
  const i = document.querySelector("#global-search");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(i, "何希言");
  i.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await sleep(400);
const phoneHits = await evaluate(`(() => {
  const items = [...document.querySelectorAll("#global-results .gs-item")];
  return {
    count: items.length,
    scope: items[0] ? (items[0].querySelector(".gs-scope") || {}).textContent || "" : "",
    sub: items[0] ? (items[0].querySelector(".gs-sub") || {}).textContent || "" : "",
  };
})()`);
check("phone search rows carry their season/group scope", phoneHits.count > 0 && /Season 33/.test(phoneHits.scope), `${phoneHits.count} hits · ${phoneHits.scope.trim()}`);
await evaluate(`(() => {
  const i = document.querySelector("#global-search");
  i.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
})()`);
await sleep(320);
const sheetClosed = await evaluate(`(() => ({
  surface: !!document.querySelector(".gsearch-surface"),
  expanded: document.querySelector("#global-search").getAttribute("aria-expanded"),
}))()`);
check("phone search sheet closes with Escape", !sheetClosed.surface && sheetClosed.expanded === "false", `expanded=${sheetClosed.expanded}`);

check("no uncaught page exceptions", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 400));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed`);
ws.close();
try { chrome.kill(); } catch {}
try { preview?.kill("SIGTERM"); } catch {}
process.exit(failed.length ? 1 : 0);
