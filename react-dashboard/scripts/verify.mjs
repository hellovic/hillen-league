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
const startGroup = await evaluate(`document.querySelector("#group-select").value`);
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
await evaluate(`(() => { const sel = document.querySelector("#group-select"); if ([...sel.options].some((o) => o.value === ${JSON.stringify(startGroup)})) { sel.value = ${JSON.stringify(startGroup)}; sel.dispatchEvent(new Event("change", { bubbles: true })); } })()`);

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
await evaluate(`[...document.querySelectorAll("#mobile-nav [data-go]")].find((b) => b.dataset.go === "standings").click()`);
await waitFor(`location.hash.startsWith("#/standings")`, "mobile nav navigation");
check("mobile bottom nav navigates", true, await evaluate("location.hash"));
await evaluate(`document.querySelector("#more-nav").open = true`);
await sleep(100);
await evaluate(`[...document.querySelectorAll("#more-nav [data-go]")].find((b) => b.dataset.go === "leaders").click()`);
await waitFor(`location.hash.startsWith("#/leaders")`, "mobile more-menu navigation");
check("mobile “More” menu reaches Leaders", true, await evaluate("location.hash"));

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

check("no uncaught page exceptions", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 400));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed`);
ws.close();
try { chrome.kill(); } catch {}
try { preview?.kill("SIGTERM"); } catch {}
process.exit(failed.length ? 1 : 0);
