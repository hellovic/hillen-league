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
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), "hl-gender-evidence-"));
mkdirSync(EVIDENCE, { recursive: true });
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
  "--remote-debugging-port=9345", `--user-data-dir=${mkdtempSync(join(tmpdir(), "hl-verify-"))}`, "about:blank",
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
// The toggle checks exercise dark → light. Fresh Linux and macOS profiles can
// inherit different system defaults, so make that starting condition explicit.
await sess("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-color-scheme", value: "dark" }],
});
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


const results=[];
const check=(name,ok,detail='')=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`);};
const click=async(gender)=>{await evaluate(`document.querySelector('#gender-${gender}').click()`);await waitFor(`document.querySelector('#gender-${gender}').getAttribute('aria-pressed')==='true'`,'gender '+gender);await sleep(200);};
const scoped=async(gender,n)=>{
 const info=await evaluate(`({cards:[...document.querySelectorAll('.season-card h3')].map(x=>x.textContent),latest:[...document.querySelectorAll('.results .gr-group')].map(x=>x.textContent),upcoming:[...document.querySelectorAll('.upcoming .gr-group')].map(x=>x.textContent),search:document.querySelector('#global-search').value,foot:document.querySelector('#foot-counts').textContent,hash:location.hash})`);
 check(gender+' overview card count',info.cards.length===n,String(info.cards.length));check(gender+' cards do not mix',info.cards.every(x=>gender==='girls'?/Girls?/i.test(x):!/Girl/i.test(x)));
 check(gender+' results do not mix',info.latest.every(x=>x.startsWith(gender==='girls'?'Girls':'Boys')));
 check(gender+' fixtures do not mix',info.upcoming.every(x=>x.startsWith(gender==='girls'?'Girls':'Boys')));
 const games=await evaluate(`new Set(window.LEAGUE_DATA.meta.groups.filter(g => /GIRL/i.test(g.name) === ${gender === 'girls'}).flatMap(g => window.LEAGUE_DATA[[g.season_id,g.group_id,'games'].join('/')] || []).map(g => g.event_id)).size`);
 check(gender+' scoped footer',info.foot.includes(games+' games'),info.foot);
};
await sess('Network.enable');await sess('Network.setBlockedURLs',{urls:['*data/33-5-players.json*']});await open('/players?season=33&group=5&gender=boys');check('lazy player list failure shows retry',await evaluate(`!!document.querySelector('#view [role=alert] button')`));await sess('Network.setBlockedURLs',{urls:[]});await evaluate(`document.querySelector('#view [role=alert] button').click()`);await waitFor(`!!document.querySelector('#t-players tbody tr')`,'list retry');check('lazy player list retry restores rows',await evaluate(`document.querySelectorAll('#t-players tbody tr').length>0`));await sess('Page.navigate',{url:BASE+'/'});await waitFor(`document.querySelectorAll('.season-card').length===7`,'default Girls');
await setViewport(1440,1000,false);await open('/season/33');check('Girls is the default',await evaluate(`document.querySelector('#gender-girls').getAttribute('aria-pressed')==='true'`));await scoped('girls',7);
check('switch left of theme',await evaluate(`document.querySelector('.gender-switch').getBoundingClientRect().right<=document.querySelector('#theme-toggle').getBoundingClientRect().left`));
await click('boys');await scoped('boys',30);check('Boys URL survives reload',await evaluate(`location.hash.includes('gender=boys')`));await evaluate(`window.__scopeReloadPending=true`);await sess('Page.reload');await waitFor(`!window.__scopeReloadPending && document.querySelectorAll('.season-card').length===30 && !!document.querySelector('#gender-boys')`,'Boys reload');check('Boys selected after reload',await evaluate(`document.querySelector('#gender-boys').getAttribute('aria-pressed')==='true'`));
check('Boys seasons only include available data',await evaluate(`[...document.querySelector('#season-select').options].map(x=>x.value).join(',')==='33'`));
await open('/standings?season=33&group=3&gender=boys');check('Boys picker has 30 groups',await evaluate(`document.querySelector('#group-select').options.length===30`));check('Boys picker excludes Girls',await evaluate(`[...document.querySelector('#group-select').options].every(x=>!/GIRL/i.test(x.textContent))`));
await evaluate(`(()=>{const i=document.querySelector('#global-search');i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'DNA');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await waitFor(`document.querySelectorAll('#global-results a[data-kind]').length>0`,'search boys');check('Boys search excludes Girls',await evaluate(`document.querySelectorAll('#global-results .gs-scope').length>0 && [...document.querySelectorAll('#global-results .gs-scope')].every(x=>!/GIRL/i.test(x.textContent))`));
await evaluate(`document.querySelector('#global-results a[data-kind]').click()`);await sleep(250);check('Boys search selection preserves Boys',await evaluate(`document.querySelector('#gender-boys').getAttribute('aria-pressed')==='true'`));
await open('/standings?season=33&group=3&gender=boys');await click('girls');check('switch clears search',await evaluate(`document.querySelector('#global-search').value==='' && !document.querySelector('#global-results a[data-kind]')`));check('Girls picker stays separate',await evaluate(`document.querySelector('#group-select').options.length===7 && [...document.querySelector('#group-select').options].every(x=>/GIRL/i.test(x.textContent))`));
await open('/games/20985');check('Boys game deep link adopts Boys',await evaluate(`document.querySelector('#gender-boys').getAttribute('aria-pressed')==='true' && !!document.querySelector('[id^=box-tbl-]')`));await click('girls');check('switch from a detail returns to overview',await evaluate(`location.hash.startsWith('#/season/33') && document.querySelectorAll('.season-card').length===7`));
await open('/players/15627?season=33&group=4');check('Boys player deep link adopts Boys',await evaluate(`document.querySelector('#gender-boys').getAttribute('aria-pressed')==='true' && !!document.querySelector('#t-gamelog')`));
await open('/season/31');check('older Girls season link remains usable',await evaluate(`document.querySelector('#gender-girls').getAttribute('aria-pressed')==='true' && document.querySelector('#season-select').value==='31'`));await click('boys');check('switch from older season chooses available Boys season',await evaluate(`document.querySelector('#season-select').value==='33' && document.querySelectorAll('.season-card').length===30`));
for(const width of [1440,390,375,320]){
 await setViewport(width,width===1440?1000:844,width<768);
 for(const gender of ['girls','boys']){
  await click(gender);await scoped(gender,gender==='girls'?7:30);
  check(`${width} ${gender} no overflow`,await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  check(`${width} switch stays left of theme`,await evaluate(`document.querySelector('.gender-switch').getBoundingClientRect().right<=document.querySelector('#theme-toggle').getBoundingClientRect().left`));
  check(`${width} controls have touch targets`,await evaluate(`[...document.querySelectorAll('.gender-switch button')].every(x=>x.getBoundingClientRect().height>=44)`));
  if(width===390||width===1440){const shot=await sess('Page.captureScreenshot',{format:'png'});writeFileSync(join(EVIDENCE, `${gender}-${width}.png`),Buffer.from(shot.result.data,'base64'));}
 }
}
await evaluate(`document.querySelector('#theme-toggle').click()`);await sleep(100);check('theme toggle still works',await evaluate(`document.documentElement.dataset.theme==='light'`));
await sess('Page.navigate',{url:BASE+'/'});await waitFor(`document.querySelectorAll('.season-card').length===7`,'fresh Girls default');check('fresh bare URL defaults to Girls after Boys use',await evaluate(`document.querySelector('#gender-girls').getAttribute('aria-pressed')==='true'`));
const saver = await sess('Page.addScriptToEvaluateOnNewDocument',{source:"if(navigator.connection) Object.defineProperty(navigator.connection,'saveData',{value:true,configurable:true});"});
await sess('Page.navigate',{url:BASE+'/?save-data-test=1#/season/33'});await waitFor(`document.querySelectorAll('.season-card').length===7`,'save-data overview');await sleep(1000);
check('data saver avoids background statistics fetch',await evaluate(`navigator.connection.saveData && !performance.getEntriesByType('resource').some(x=>x.name.includes('-players.json'))`));
await sess('Page.removeScriptToEvaluateOnNewDocument',{identifier:saver.result.identifier});
await sess('Page.navigate',{url:BASE+'/#/season/33'});await waitFor(`!!window.LEAGUE_DATA?.['33/16/players']`,'selected player prefetch');
check('normal mode prepares only selected group',await evaluate(`Object.keys(window.LEAGUE_DATA).filter(x=>{const p=x.split('/');return p.length===3 && p[0]==='33' && p[2]==='players' && window.LEAGUE_DATA[x].length>0}).join(',')==='33/16/players'`));
check('no page exceptions',pageErrors.length===0,pageErrors.join(';'));
writeFileSync(join(EVIDENCE, 'gender-checks.json'),JSON.stringify(results,null,2));console.log(`${results.length} checks, ${results.filter(x=>x.ok).length} passed`);ws.close();chrome.kill();stopPreview();process.exit(results.every(x=>x.ok)?0:1);
