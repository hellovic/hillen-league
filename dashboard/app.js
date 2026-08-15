/* Hillen League Dashboard — vanilla JS, no dependencies. */
"use strict";

const state = { meta: null, season: 32, group: 26, view: "standings", sort: {} };

/* ---------------- utils ---------------- */

/* Two data modes:
 *  - "api":    local dev server (server.py) serves /api/* live from SQLite
 *  - "static": static hosts (GitHub Pages / Netlify / Cloudflare) — data is
 *              pre-exported JSON under data/<season>/<group>/...
 * Detected once on first request: /api/meta answers -> api mode, else static.
 */
let apiMode = null;

async function api(path, params = {}) {
  if (apiMode === null) {
    try {
      const r = await fetch("/api/meta");
      apiMode = r.ok ? "api" : "static";
    } catch (e) { apiMode = "static"; }
  }
  if (apiMode === "static") {
    // cache-bust: GitHub Pages caches assets ~10 min; the export stamps
    // index.html with window.HL_BUILD so every fetch is versioned
    const v = (typeof window.HL_BUILD !== "undefined") ? "?v=" + window.HL_BUILD : "";
    const file = path === "meta"
      ? "data/meta.json"
      : `data/${params.season ?? state.season}/${params.group ?? state.group}/${path}.json`;
    let r = await fetch(file + v);
    // detail pages (games/<id>, teams/<id>, players/<id>) may belong to another
    // group than the one currently selected — try every exported combo
    if (!r.ok && path !== "meta" && !params.group && state.meta) {
      for (const c of state.meta.combos) {
        const alt = `data/${c.season}/${c.group}/${path}.json`;
        const r2 = await fetch(alt + v);
        if (r2.ok) { r = r2; break; }
      }
    }
    if (!r.ok) throw new Error(`${file} -> ${r.status}`);
    return r.json();
  }
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`/api/${path}${qs ? "?" + qs : ""}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(d) { return d ? d.slice(5).replace("-", "/") : ""; }

function resultOf(g, teamId) {
  if (g.status !== "completed") return { text: "—", cls: "draw" };
  const mine = g.home_team_id === teamId ? g.home_score : g.away_score;
  const opp = g.home_team_id === teamId ? g.away_score : g.home_score;
  if (mine > opp) return { text: `W ${mine}-${opp}`, cls: "winner" };
  if (mine < opp) return { text: `L ${mine}-${opp}`, cls: "loser" };
  return { text: `T ${mine}-${opp}`, cls: "draw" };
}

function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    let r;
    if (typeof va === "number" && typeof vb === "number") r = va - vb;
    else r = String(va ?? "").localeCompare(String(vb ?? ""), "zh");
    return dir === "asc" ? r : -r;
  });
}

/* Generic sortable table: builds thead (with sort arrows) + tbody.
 * pin: 0 = none, 1 = pin first column, 2 = pin second column (mobile only). */
function makeTable(keys, rows, rowHtml, tableId, pin = 0) {
  const s = state.sort;
  const ths = keys.map(k => {
    const arrow = s.key === k.key ? (s.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-key="${k.key}" class="${k.num ? "num" : ""}${s.key === k.key ? " sorted" : ""}">${k.label}${arrow}</th>`;
  }).join("");
  const body = rows.map(rowHtml).join("") ||
    `<tr><td colspan="${keys.length}" class="empty">No data</td></tr>`;
  return `<table class="data${pin ? " pin" + pin : ""}" ${tableId ? `id="${tableId}"` : ""}>
    <thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table>`;
}

/* Bind sort clicks on a container (delegated). */
function bindSort(container, redraw) {
  container.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th) return;
    const key = th.dataset.key;
    const s = state.sort;
    if (s.key === key) s.dir = s.dir === "asc" ? "desc" : "asc";
    else { s.key = key; s.dir = "desc"; }
    redraw();
  });
}

/* Rows with data-href navigate on click (delegated, once). */
document.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-href]");
  if (tr) { location.hash = tr.dataset.href; }
});

/* ---------------- header / controls ---------------- */

async function init() {
  state.meta = await api("meta");
  const sel = document.getElementById("season-select");
  state.meta.seasons.forEach(s => {
    const o = document.createElement("option");
    o.value = s.season_id; o.textContent = `${s.season_id} · ${s.name}`;
    if (s.season_id === state.season) o.selected = true;
    sel.appendChild(o);
  });
  const gsel = document.getElementById("group-select");
  // sort groups by name, ascending (A–Z) — the raw list follows group_id order
  const groups = [...state.meta.groups].sort((a, b) => a.name.localeCompare(b.name, "en"));
  groups.forEach(g => {
    const o = document.createElement("option");
    o.value = g.group_id; o.textContent = g.name;
    if (g.group_id === state.group) o.selected = true;
    gsel.appendChild(o);
  });
  const c = state.meta.counts;
  document.getElementById("foot-counts").textContent =
    `${c.teams} teams · ${c.players} players · ${c.games} games · ${c.box_scores} box-score rows`;
  sel.addEventListener("change", () => { state.season = +sel.value; route(); });
  gsel.addEventListener("change", () => { state.group = +gsel.value; route(); });
  document.querySelectorAll("#tabs button").forEach(b => {
    b.addEventListener("click", () => { location.hash = "/" + b.dataset.view; });
  });
  window.addEventListener("hashchange", route);
  route();
}

function setView(v) {
  state.view = v;
  document.querySelectorAll("#tabs button").forEach(b =>
    b.classList.toggle("active", state.view === b.dataset.view));
  const s = state.meta.seasons.find(x => x.season_id === state.season);
  const g = state.meta.groups.find(x => x.group_id === state.group);
  document.getElementById("meta-line").textContent =
    `${s ? s.name : "Season " + state.season} · ${g ? g.name : "Group " + state.group}`;
  window.scrollTo(0, 0);
}

/* ---------------- routing ---------------- */

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  const view = document.getElementById("view");
  state.sort = {};
  if (parts[0] === "teams" && parts[1]) { setView("teams"); renderTeamDetail(view, +parts[1]); }
  else if (parts[0] === "players" && parts[1]) { setView("players"); renderPlayerDetail(view, +parts[1]); }
  else if (parts[0] === "games" && parts[1]) { setView("games"); renderGameDetail(view, +parts[1]); }
  else if (parts[0] === "teams") { setView("teams"); renderTeams(view); }
  else if (parts[0] === "players") { setView("players"); renderPlayers(view); }
  else if (parts[0] === "games") { setView("games"); renderGames(view); }
  else { setView("standings"); renderStandings(view); }
}

/* ---------------- standings ---------------- */

async function renderStandings(view) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const [standings, teams, games] = await Promise.all([
    api("standings", { season: state.season, group: state.group }),
    api("teams", { season: state.season, group: state.group }),
    api("games", { season: state.season, group: state.group }),
  ]);
  const maxPf = Math.max(...teams.map(t => t.pts_for), 1);
  const played = games.filter(g => g.status === "completed");
  const keys = [
    { key: "rank", label: "#", num: true },
    { key: "team_name", label: "Team" },
    { key: "gp", label: "GP", num: true },
    { key: "wins", label: "W", num: true },
    { key: "losses", label: "L", num: true },
    { key: "forfeits", label: "F", num: true },
    { key: "diff", label: "±", num: true },
    { key: "points", label: "Pts", num: true },
  ];
  const rowHtml = (s) => `<tr data-href="#/teams/${s.team_id}">
      <td class="num">${s.rank}</td>
      <td><a class="row-link" href="#/teams/${s.team_id}">${esc(s.team_name)}</a></td>
      <td class="num">${s.gp}</td>
      <td class="num">${s.wins}</td>
      <td class="num">${s.losses}</td>
      <td class="num">${s.forfeits}</td>
      <td class="num ${s.diff === null ? "" : s.diff >= 0 ? "winner" : "loser"}">
        ${s.diff === null ? "—" : s.diff > 0 ? "+" + s.diff : s.diff}</td>
      <td class="num">${s.points}</td>
    </tr>`;
  view.innerHTML = `
    <div class="view-head"><h2>Standings</h2><div class="sub">${teams.length} teams · ${played.length} played</div></div>
    <div class="grid-2">
      <div class="card"><h3>Group Table</h3>
        <div id="st-table">${makeTable(keys, standings, rowHtml, "t-standings", 2)}</div>
      </div>
      <div>
        <div class="card"><h3>Points for / against</h3>
          ${teams.map(t => `
            <div class="bar-row">
              <span class="bl"><a class="row-link" href="#/teams/${t.team_id}">${esc(t.team_name)}</a></span>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.max(t.pts_for / maxPf * 100, 2)}%"></div></div>
              <span class="bv">${t.pts_for}</span>
            </div>`).join("")}
        </div>
        <div class="card"><h3>Latest results</h3>
          ${games.slice(-5).reverse().map(g => `
            <div class="bar-row" style="cursor:pointer" onclick="location.hash='#/games/${g.event_id}'">
              <span class="bl" style="width:100%">${fmtDate(g.game_date)} · ${esc(g.home_name)} ${g.home_score ?? "—"}–${g.away_score ?? "—"} ${esc(g.away_name)}</span>
            </div>`).join("")}
        </div>
      </div>
    </div>`;
  bindSort(view.querySelector("#st-table"), () => {
    document.querySelector("#st-table").innerHTML =
      makeTable(keys, sortRows(standings, state.sort.key || "rank", state.sort.dir || "asc"), rowHtml, "t-standings", 2);
  });
}

/* ---------------- teams ---------------- */

async function renderTeams(view) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const teams = await api("teams", { season: state.season, group: state.group });
  const keys = [
    { key: "team_name", label: "Team" },
    { key: "gp", label: "GP", num: true },
    { key: "wins", label: "W", num: true },
    { key: "losses", label: "L", num: true },
    { key: "pts_for", label: "PF", num: true },
    { key: "pts_against", label: "PA", num: true },
    { key: "diff", label: "±", num: true },
    { key: "manager", label: "Manager" },
    { key: "captain_name", label: "Captain" },
  ];
  const rowHtml = (t) => `<tr data-href="#/teams/${t.team_id}">
      <td><a class="row-link" href="#/teams/${t.team_id}">${esc(t.team_name)}</a></td>
      <td class="num">${t.gp}</td>
      <td class="num">${t.wins}</td>
      <td class="num">${t.losses}</td>
      <td class="num">${t.pts_for}</td>
      <td class="num">${t.pts_against}</td>
      <td class="num ${t.diff >= 0 ? "winner" : "loser"}">${t.diff > 0 ? "+" + t.diff : t.diff}</td>
      <td>${esc(t.manager)}</td>
      <td>${esc(t.captain_name || "—")}</td>
    </tr>`;
  view.innerHTML = `
    <div class="view-head"><h2>Teams</h2><div class="sub">${teams.length} teams · season ${state.season}</div></div>
    <div class="card">
      <div id="teams-table">${makeTable(keys, teams, rowHtml, "t-teams", 1)}</div>
    </div>`;
  bindSort(view.querySelector("#teams-table"), () => {
    document.querySelector("#teams-table").innerHTML =
      makeTable(keys, sortRows(teams, state.sort.key || "team_name", state.sort.dir || "asc"), rowHtml, "t-teams", 1);
  });
}

async function renderTeamDetail(view, tid) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const t = await api("teams/" + tid, { season: state.season });
  if (t.error) { view.innerHTML = `<div class="empty">${esc(t.error)}</div>`; return; }
  const leaders = t.leaders.slice(0, 5);
  view.innerHTML = `
    <a class="back" href="#/teams">← Teams</a>
    <div class="view-head"><h2>${esc(t.team_name)}</h2><div class="sub">${esc(t.group_name || "")} · season ${state.season}</div></div>
    <div class="grid-2">
      <div class="card"><h3>Season record</h3>
        <div class="scoreboard" style="gap:26px">
          <div class="team"><div class="tname">W</div><div class="score ${t.wins > t.losses ? "winner" : ""}">${t.wins}</div></div>
          <div class="vs">—</div>
          <div class="team"><div class="tname">L</div><div class="score ${t.losses > t.wins ? "loser" : ""}">${t.losses}</div></div>
        </div>
        <div class="qstrip">
          <div class="q"><b>${t.gp}</b><span>GP</span></div>
          <div class="q"><b>${t.pts_for}</b><span>PF</span></div>
          <div class="q"><b>${t.pts_against}</b><span>PA</span></div>
          <div class="q"><b>${t.pts_for - t.pts_against > 0 ? "+" : ""}${t.pts_for - t.pts_against}</b><span>±</span></div>
        </div>
      </div>
      <div class="card"><h3>Club info</h3>
        <dl class="kv">
          <dt>Manager</dt><dd>${esc(t.manager || "—")}</dd>
          <dt>Captain</dt><dd>${t.captain_player_id ? `<a class="row-link" href="#/players/${t.captain_player_id}">${esc(t.captain_name)}</a>` : "—"}</dd>
          <dt>Home colour</dt><dd>${esc(t.home_color || "—")}</dd>
          <dt>Away colour</dt><dd>${esc(t.away_color || "—")}</dd>
        </dl>
      </div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>Roster <span class="cn">隊員名單</span></h3>
        <table class="data"><thead><tr><th class="num">#</th><th>Player</th></tr></thead><tbody>
          ${t.roster.map(p => `<tr data-href="#/players/${p.player_id}">
            <td class="num mono">${p.jersey_no ?? "—"}</td>
            <td><a class="row-link" href="#/players/${p.player_id}">${esc(p.player_name)}</a></td>
          </tr>`).join("")}
        </tbody></table>
      </div>
      <div class="card"><h3>Season leaders</h3>
        <table class="data"><thead><tr>
          <th>Player</th><th class="num">GP</th><th class="num">PTS</th><th class="num">REB</th>
          <th class="num">AST</th><th class="num">ST</th><th class="num">EFF</th>
        </tr></thead><tbody>
          ${leaders.map(p => `<tr data-href="#/players/${p.player_id}">
            <td><a class="row-link" href="#/players/${p.player_id}">${esc(p.player_name)}</a></td>
            <td class="num">${p.gp}</td><td class="num">${p.pts}</td><td class="num">${p.reb}</td>
            <td class="num">${p.ast}</td><td class="num">${p.stl}</td><td class="num">${p.eff}</td>
          </tr>`).join("")}
        </tbody></table>
      </div>
    </div>
    <div class="card"><h3>Results <span class="cn">賽程</span></h3>
      <table class="data pin1"><thead><tr>
        <th>Date</th><th>Opponent</th><th>Result</th><th class="num">Team</th><th class="num">Opp</th><th>Venue</th>
      </tr></thead><tbody>
        ${t.games.map(g => {
          const isHome = g.home_team_id === tid;
          const opp = isHome ? g.away_name : g.home_name;
          const oppId = isHome ? g.away_team_id : g.home_team_id;
          const r = resultOf(g, tid);
          return `<tr data-href="#/games/${g.event_id}">
            <td>${esc(g.game_date)}</td>
            <td>${isHome ? "vs" : "@"} <a class="row-link" href="#/teams/${oppId}">${esc(opp)}</a></td>
            <td class="${r.cls}">${r.text}</td>
            <td class="num mono">${g.home_team_id === tid ? g.home_score : g.away_score}</td>
            <td class="num mono">${g.home_team_id === tid ? g.away_score : g.home_score}</td>
            <td>${esc(g.venue || "—")}</td>
          </tr>`;
        }).join("") || '<tr><td colspan="6" class="empty">No games</td></tr>'}
      </tbody></table>
    </div>`;
}

/* ---------------- players ---------------- */

async function renderPlayers(view) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const players = await api("players", { season: state.season, group: state.group });
  const keys = [
    { key: "player_name", label: "Player" },
    { key: "team_name", label: "Team" },
    { key: "gp", label: "GP", num: true },
    { key: "minutes", label: "MIN", num: true },
    { key: "ppg", label: "PPG", num: true },
    { key: "pts", label: "PTS", num: true },
    { key: "rpg", label: "RPG", num: true },
    { key: "apg", label: "APG", num: true },
    { key: "spg", label: "SPG", num: true },
    { key: "bpg", label: "BPG", num: true },
    { key: "effpg", label: "EFF", num: true },
    { key: "fg_pct", label: "FG%", num: true },
    { key: "fg3_pct", label: "3P%", num: true },
  ];
  const rowHtml = (p) => {
    const fgp = p.fga ? (p.fgm / p.fga * 100).toFixed(1) : "—";
    const t3p = p.fg3a ? (p.fg3m / p.fg3a * 100).toFixed(1) : "—";
    return `<tr data-href="#/players/${p.player_id}">
      <td><a class="row-link" href="#/players/${p.player_id}">${esc(p.player_name)}</a></td>
      <td><a class="row-link" style="color:var(--muted)" href="#/teams/${p.team_id}">${esc(p.team_name)}</a></td>
      <td class="num">${p.gp}</td>
      <td class="num mono">${p.minutes.toFixed(1)}</td>
      <td class="num">${p.ppg}</td>
      <td class="num">${p.pts}</td>
      <td class="num">${p.rpg}</td>
      <td class="num">${p.apg}</td>
      <td class="num">${p.spg}</td>
      <td class="num">${p.bpg}</td>
      <td class="num">${p.effpg}</td>
      <td class="num">${fgp}</td>
      <td class="num">${t3p}</td>
    </tr>`;
  };
  const draw = () => {
    const q = (document.getElementById("player-search").value || "").toLowerCase();
    let rows = players;
    if (q) rows = players.filter(p =>
      p.player_name.toLowerCase().includes(q) || p.team_name.toLowerCase().includes(q));
    rows = sortRows(rows, state.sort.key || "pts", state.sort.dir || "desc");
    document.querySelector("#players-table").innerHTML =
      makeTable(keys, rows, rowHtml, "t-players", 1);
  };
  view.innerHTML = `
    <div class="view-head">
      <h2>Players</h2>
      <div class="toolbar">
        <input type="search" id="player-search" placeholder="Search name / team…">
        <div class="sub">${players.length} players</div>
      </div>
    </div>
    <div class="card"><div id="players-table"></div></div>`;
  bindSort(view.querySelector("#players-table"), draw);
  document.getElementById("player-search").addEventListener("input", draw);
  draw();
}

async function renderPlayerDetail(view, pid) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const p = await api("players/" + pid, { season: state.season });
  if (p.error) { view.innerHTML = `<div class="empty">${esc(p.error)}</div>`; return; }
  view.innerHTML = `
    <a class="back" href="#/players">← Players</a>
    <div class="view-head"><h2>${esc(p.player_name)}</h2><div class="sub"><a class="row-link" href="#/teams/${p.team_id}">${esc(p.team_name)}</a> · season ${state.season}</div></div>
    <div class="grid-2">
      <div class="card"><h3>Season totals</h3>
        <div class="qstrip">
          <div class="q"><b>${p.gp}</b><span>GP</span></div>
          <div class="q"><b>${p.pts}</b><span>PTS</span></div>
          <div class="q"><b>${p.reb}</b><span>REB</span></div>
          <div class="q"><b>${p.ast}</b><span>AST</span></div>
          <div class="q"><b>${p.stl}</b><span>ST</span></div>
          <div class="q"><b>${p.blk}</b><span>BS</span></div>
          <div class="q"><b>${p.eff}</b><span>EFF</span></div>
        </div>
        <dl class="kv" style="margin-top:12px">
          <dt>Minutes</dt><dd class="mono">${p.minutes.toFixed(1)} (${p.gp ? (p.minutes / p.gp).toFixed(1) : 0}/g)</dd>
          <dt>Shooting</dt><dd class="mono">${p.fgm}/${p.fga} FG · ${p.fg2m}/${p.fg2a} 2P · ${p.fg3m}/${p.fg3a} 3P · ${p.ftm}/${p.fta} FT</dd>
          <dt>Off / Def reb</dt><dd class="mono">${p.off_reb} / ${p.def_reb}</dd>
          <dt>Turnovers / fouls</dt><dd class="mono">${p.tov} / ${p.pf}</dd>
          <dt>+/-</dt><dd class="mono">${p.plus_minus > 0 ? "+" : ""}${p.plus_minus}</dd>
        </dl>
      </div>
      <div class="card"><h3>Per game</h3>
        <div class="qstrip">
          <div class="q"><b>${(p.pts / Math.max(p.gp, 1)).toFixed(1)}</b><span>PPG</span></div>
          <div class="q"><b>${(p.reb / Math.max(p.gp, 1)).toFixed(1)}</b><span>RPG</span></div>
          <div class="q"><b>${(p.ast / Math.max(p.gp, 1)).toFixed(1)}</b><span>APG</span></div>
          <div class="q"><b>${(p.stl / Math.max(p.gp, 1)).toFixed(1)}</b><span>SPG</span></div>
          <div class="q"><b>${(p.blk / Math.max(p.gp, 1)).toFixed(1)}</b><span>BPG</span></div>
          <div class="q"><b>${(p.eff / Math.max(p.gp, 1)).toFixed(1)}</b><span>EFF</span></div>
        </div>
      </div>
    </div>
    <div class="card"><h3>Game log <span class="cn">比賽表現</span></h3>
      <table class="data pin1"><thead><tr>
        <th>Date</th><th>Opponent</th><th>Result</th>
        <th class="num">MIN</th><th class="num">PTS</th><th class="num">2PT</th><th class="num">3PT</th>
        <th class="num">FT</th><th class="num">REB</th><th class="num">AST</th><th class="num">ST</th>
        <th class="num">BS</th><th class="num">TO</th><th class="num">PF</th><th class="num">EFF</th><th class="num">+/−</th>
      </tr></thead><tbody>
        ${p.games.map(g => {
          const isHome = g.home_team_id === p.team_id;
          const r = resultOf(g, p.team_id);
          return `<tr data-href="#/games/${g.event_id}">
            <td>${esc(g.game_date)}</td>
            <td>${isHome ? "vs" : "@"} <a class="row-link" href="#/teams/${isHome ? g.away_team_id : g.home_team_id}">${esc(g.opponent)}</a></td>
            <td class="${r.cls}">${r.text}</td>
            <td class="num mono">${esc(g.minutes)}</td>
            <td class="num mono">${g.pts}</td>
            <td class="num mono">${g.fgm - g.fg3m}-${g.fga - g.fg3a}</td>
            <td class="num mono">${g.fg3m}-${g.fg3a}</td>
            <td class="num mono">${g.ftm}-${g.fta}</td>
            <td class="num">${g.tot_reb}</td>
            <td class="num">${g.ast}</td>
            <td class="num">${g.stl}</td>
            <td class="num">${g.blk}</td>
            <td class="num">${g.tov}</td>
            <td class="num">${g.pf}</td>
            <td class="num">${g.eff}</td>
            <td class="num ${g.plus_minus >= 0 ? "winner" : "loser"}">${g.plus_minus > 0 ? "+" : ""}${g.plus_minus}</td>
          </tr>`;
        }).join("") || '<tr><td colspan="16" class="empty">No games</td></tr>'}
      </tbody></table>
    </div>`;
}

/* ---------------- games ---------------- */

async function renderGames(view) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const games = await api("games", { season: state.season, group: state.group });
  const played = games.filter(g => g.status === "completed");
  const keys = [
    { key: "game_date", label: "Date" },
    { key: "home_name", label: "Home" },
    { key: "home_score", label: "Score", num: true },
    { key: "away_name", label: "Away" },
    { key: "venue", label: "Venue" },
    { key: "status", label: "Status" },
  ];
  const rowHtml = (g) => `<tr data-href="#/games/${g.event_id}">
      <td>${esc(g.game_date)} ${esc(g.start_time || "")}</td>
      <td><a class="row-link" href="#/teams/${g.home_team_id}">${esc(g.home_name)}</a></td>
      <td class="num mono">${g.status === "completed" ? `${g.home_score}–${g.away_score}` : "—"}</td>
      <td><a class="row-link" href="#/teams/${g.away_team_id}">${esc(g.away_name)}</a></td>
      <td>${esc(g.venue || "—")}</td>
      <td>${g.status === "completed" ? '<span class="badge w">played</span>'
             : g.status === "forfeit" ? '<span class="badge l">forfeit</span>'
             : g.status === "not_played" ? '<span class="badge np">not played</span>'
             : '<span class="badge np">scheduled</span>'}</td>
    </tr>`;
  view.innerHTML = `
    <div class="view-head"><h2>Games</h2><div class="sub">${games.length} scheduled · ${played.length} completed</div></div>
    <div class="card">
      <div id="games-table">${makeTable(keys, games, rowHtml, "t-games", 1)}</div>
    </div>`;
  bindSort(view.querySelector("#games-table"), () => {
    document.querySelector("#games-table").innerHTML =
      makeTable(keys, sortRows(games, state.sort.key || "game_date", state.sort.dir || "asc"), rowHtml, "t-games", 1);
  });
}

async function renderGameDetail(view, eid) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const g = await api("games/" + eid);
  if (g.error) { view.innerHTML = `<div class="empty">${esc(g.error)}</div>`; return; }
  const hw = g.home_score > g.away_score, aw = g.away_score > g.home_score;
  const qOf = (tid) => (g.quarters || []).find(q => q.team_id === tid) || {};
  const tsOf = (tid) => (g.team_stats || []).find(s => s.team_id === tid) || {};
  const boxOf = (tid) => g.box.filter(b => b.team_id === tid);

  const teamTable = (tid, name, color, win) => {
    const rows = boxOf(tid);
    const totals = rows.reduce((a, b) => {
      ["fg2m","fg2a","fg3m","fg3a","fgm","fga","ftm","fta","off_reb","def_reb","tot_reb",
       "ast","stl","blk","fb","ba","tov","pf","eff","pts"].forEach(k => a[k] = (a[k] || 0) + (b[k] || 0));
      a.plus_minus += b.plus_minus || 0;
      return a;
    }, { plus_minus: 0 });
    return `
    <div class="card">
      <h3>${esc(name)} ${color ? `<span class="pill">${esc(color)}</span>` : ""} <span class="cn">${win === null ? "" : win ? "WINNER" : "LOSER"}</span></h3>
      <table class="data pin2">
        <thead><tr>
          <th class="num">#</th><th>Player</th><th class="num">MIN</th>
          <th class="num">2PT</th><th class="num">3PT</th><th class="num">FG</th><th class="num">FT</th>
          <th class="num">REB</th><th class="num">AST</th><th class="num">ST</th><th class="num">BS</th>
          <th class="num">TO</th><th class="num">PF</th><th class="num">EFF</th><th class="num">+/−</th><th class="num">PTS</th>
        </tr></thead>
        <tbody>
          ${rows.map(b => `<tr data-href="#/players/${b.player_id}" class="${b.minutes === "0:00" ? "dnp-row" : ""}">
            <td class="num mono">${b.jersey_no ?? "—"}</td>
            <td><a class="row-link" href="#/players/${b.player_id}">${esc(b.player_name)}</a>
                ${b.minutes === "0:00" ? '<span class="badge np">DNP</span>' : ""}</td>
            <td class="num mono">${b.minutes === "0:00" ? '<span class="dnp">—</span>' : esc(b.minutes)}</td>
            <td class="num mono">${b.fg2m}-${b.fg2a}</td>
            <td class="num mono">${b.fg3m}-${b.fg3a}</td>
            <td class="num mono">${b.fgm}-${b.fga}</td>
            <td class="num mono">${b.ftm}-${b.fta}</td>
            <td class="num">${b.tot_reb}</td><td class="num">${b.ast}</td><td class="num">${b.stl}</td>
            <td class="num">${b.blk}</td><td class="num">${b.tov}</td><td class="num">${b.pf}</td>
            <td class="num">${b.eff}</td>
            <td class="num ${b.plus_minus >= 0 ? "winner" : "loser"}">${b.plus_minus > 0 ? "+" : ""}${b.plus_minus}</td>
            <td class="num mono">${b.pts}</td>
          </tr>`).join("") || '<tr><td colspan="16" class="empty">No box score</td></tr>'}
        </tbody>
        <tfoot><tr>
          <td colspan="3"><b>Team total</b></td>
          <td class="num mono">${totals.fg2m}-${totals.fg2a}</td>
          <td class="num mono">${totals.fg3m}-${totals.fg3a}</td>
          <td class="num mono">${totals.fgm}-${totals.fga}</td>
          <td class="num mono">${totals.ftm}-${totals.fta}</td>
          <td class="num">${totals.tot_reb}</td><td class="num">${totals.ast}</td><td class="num">${totals.stl}</td>
          <td class="num">${totals.blk}</td><td class="num">${totals.tov}</td><td class="num">${totals.pf}</td>
          <td class="num">${totals.eff}</td>
          <td class="num">${totals.plus_minus > 0 ? "+" : ""}${totals.plus_minus}</td>
          <td class="num mono">${totals.pts}</td>
        </tr></tfoot>
      </table>
    </div>`;
  };

  const qstrip = ["Q1","Q2","Q3","Q4","OT"].map((q, i) => {
    const k = i < 4 ? "q" + (i + 1) : "ot";
    const hv = qOf(g.home_team_id)[k], av = qOf(g.away_team_id)[k];
    if (hv === undefined && av === undefined) return "";
    return `<div class="q"><b>${hv ?? "—"} : ${av ?? "—"}</b><span>${q}</span></div>`;
  }).join("");

  const perfCells = (() => {
    const h = tsOf(g.home_team_id), a = tsOf(g.away_team_id);
    return [["TO", h.turnovers, a.turnovers], ["REB", h.rebounds, a.rebounds], ["FB", h.fastbreaks, a.fastbreaks]]
      .filter(c => c[1] !== undefined || c[2] !== undefined)
      .map(c => `<div class="q"><b>${c[1] ?? "—"} : ${c[2] ?? "—"}</b><span>${c[0]}</span></div>`).join("");
  })();

  view.innerHTML = `
    <a class="back" href="#/games">← Games</a>
    <div class="view-head"><h2>${esc(g.group_name)} · ${esc(g.game_date)}</h2><div class="sub">${esc(g.venue || "")} · ${g.start_time || ""}–${g.end_time || ""}</div></div>
    <div class="card">
      <div class="scoreboard">
        <div class="team">
          <div class="tname"><a class="row-link" href="#/teams/${g.home_team_id}">${esc(g.home_name)}</a></div>
          <div class="tcolor">${esc(tsOf(g.home_team_id).shirt_color || "")}</div>
          <div class="score ${g.status === "completed" ? (hw ? "winner" : aw ? "loser" : "draw") : "draw"}">${g.home_score ?? "—"}</div>
        </div>
        <div class="vs">–</div>
        <div class="team">
          <div class="tname"><a class="row-link" href="#/teams/${g.away_team_id}">${esc(g.away_name)}</a></div>
          <div class="tcolor">${esc(tsOf(g.away_team_id).shirt_color || "")}</div>
          <div class="score ${g.status === "completed" ? (aw ? "winner" : hw ? "loser" : "draw") : "draw"}">${g.away_score ?? "—"}</div>
        </div>
      </div>
      ${g.status === "completed" ? `
      <div class="qstrip">${qstrip}</div>
      <div class="qstrip" style="margin-top:10px">${perfCells}</div>` :
      g.status === "forfeit" ? `
      <div class="empty"><b>Forfeit</b> — ${hw ? esc(g.home_name) : esc(g.away_name)} awarded the win (${g.home_score ?? "—"}–${g.away_score ?? "—"} default).</div>` :
      `<div class="empty">${g.status === "not_played" ? "Game not played (walkover / no result)." : "Scheduled — no result yet."}</div>`}
    </div>
    ${g.status === "completed" ? teamTable(g.home_team_id, g.home_name, tsOf(g.home_team_id).shirt_color, hw) +
                                teamTable(g.away_team_id, g.away_name, tsOf(g.away_team_id).shirt_color, aw) : ""}`;
}

/* ---------------- boot ---------------- */

document.addEventListener("DOMContentLoaded", init);
