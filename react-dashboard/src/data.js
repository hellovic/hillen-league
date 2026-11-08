/* Data access for the React dashboard.
 *
 * The bootstrap embeds lists and a detail-file manifest as `window.LEAGUE_DATA`, keyed as
 * `meta`, `season/<id>` and
 * `<season>/<group>/<path>`. Detail views load their group file before mounting; repeat visits reuse it. */

const RAW = (typeof window !== "undefined" && window.LEAGUE_DATA) || {};

export const meta = RAW.meta || { seasons: [], groups: [], combos: [] };
export const DEFAULT_SEASON = meta.default_season ?? meta.seasons?.[0]?.season_id ?? 33;
export const DEFAULT_GROUP = meta.default_group ?? 16;

/* Detail files are listed in the bootstrap manifest. Lists/search stay
 * synchronous; App waits for the required detail file before mounting a view. */
const detailFiles = RAW.__detail_files || {};
const listFiles = RAW.__list_files || {};
const playerIndex = RAW.__players_index || {};
export const storySpotlights = RAW.__story_spotlights || [];
const fileFor = (key) => listFiles[key] || detailFiles[key];
const pendingFiles = new Map();
const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function apiKey(path, params = {}) {
  const s = params.season ?? DEFAULT_SEASON;
  const g = params.group ?? DEFAULT_GROUP;
  const key = path === "meta" ? "meta" : path === "season" ? `season/${s}` : `${s}/${g}/${path}`;
  if (owns(RAW, key) || owns(detailFiles, key)) return key;
  if (/^(games|teams|players)\//.test(path) && !params.group) {
    const combos = [...(meta.combos || [])].sort(
      (a, b) => (b.season === s) - (a.season === s) || b.season - a.season
    );
    for (const c of combos) {
      if (path.startsWith("players/") && c.season !== s) continue;
      const candidate = `${c.season}/${c.group}/${path}`;
      if (owns(RAW, candidate) || owns(detailFiles, candidate)) return candidate;
    }
  }
  return key;
}

export function api(path, params = {}) {
  const key = apiKey(path, params);
  if (!owns(RAW, key)) throw new Error("No data available for this selection");
  return RAW[key];
}

function routeKeys(parts, ctx) {
  const [view, id, a, b] = parts;
  const playerList = `${ctx.season}/${ctx.group}/players`;
  if (view === "player-story") return [id === undefined ? "player-story" : storyKey(+id)];
  if (["games", "teams", "players"].includes(view) && +id) {
    const key = apiKey(`${view}/${+id}`, view === "games" ? {} : view === "teams" ? { season: ctx.season } : ctx);
    return [key, ...(["teams", "players"].includes(view) ? [key.split("/").slice(0, 2).join("/") + "/players"] : [])];
  }
  if (view === "players") return [playerList];
  if (view === "compare") {
    const kind = id === "t" ? "teams" : "players";
    return [...(kind === "players" ? [playerList] : []),
      ...[a, b].filter((x) => +x).map((x) => apiKey(`${kind}/${+x}`, kind === "players" ? ctx : { season: ctx.season }))];
  }
  return [];
}

const storyKey = (id) => `player-story/${id % 32}`;
export function playerStory(id) {
  return RAW[storyKey(id)]?.[id] ?? null;
}

export function storyCatalog() {
  return RAW["player-story"] || [];
}

export function routeDataReady(parts, ctx) {
  return routeKeys(parts, ctx).every((key) => owns(RAW, key) || !fileFor(key));
}

export async function loadRouteData(parts, ctx) {
  const keys = routeKeys(parts, ctx).filter((key) => !owns(RAW, key));
  const groupFiles = new Map(keys.filter((key) => detailFiles[key]).map((key) => [key.split("/").slice(0, 2).join("/"), detailFiles[key]]));
  const files = [...new Set(keys.map((key) => groupFiles.get(key.split("/").slice(0, 2).join("/")) || fileFor(key)).filter(Boolean))];
  await Promise.all(files.map((url) => {
    if (!pendingFiles.has(url)) {
      const request = fetch(new URL(url, document.baseURI)).then(async (response) => {
        if (!response.ok) throw new Error("Could not load league data. Please retry.");
        const data = await response.json();
        const required = Object.keys(detailFiles).filter((key) => detailFiles[key] === url);
        required.push(...Object.keys(listFiles).filter((key) => listFiles[key] === url));
        for (const key of [...required]) {
          if (detailFiles[key] === url) {
            const playerKey = key.split("/").slice(0, 2).join("/") + "/players";
            if (listFiles[playerKey]) required.push(playerKey);
          }
        }
        if (!data || required.some((key) => !owns(data, key))) {
          throw new Error("Incomplete league data. Please retry.");
        }
        Object.assign(RAW, data);
      }).catch((error) => {
        pendingFiles.delete(url);
        throw error;
      });
      pendingFiles.set(url, request);
    }
    return pendingFiles.get(url);
  }));
}

export function groupAgeKey(name) {
  const m = String(name || "").match(/U(\d+)([A-Za-z]?)/);
  return m ? [+m[1], m[2] || ""] : [999, String(name || "")];
}
export function groupAgeSort(a, b) {
  const ka = groupAgeKey(a.name), kb = groupAgeKey(b.name);
  return ka[0] - kb[0] || ka[1].localeCompare(kb[1], "en");
}

/* A season's groups in age order (U9 → U15, A before B) — used by the group
 * switcher and the season overview so both list divisions the same way. */
export function groupGender(name) {
  return /GIRL/i.test(name || "") ? "girls" : "boys";
}
export function genderForGroup(season, group) {
  return groupGender(groupName(season, group));
}
export function seasonsForGender(gender) {
  return (meta.seasons || []).filter((s) => seasonGroups(s.season_id, gender).length);
}
export function entityScope(parts, preferredSeason, preferredGender, preferredGroup) {
  const [kind, rawId] = parts; const id = +rawId;
  const field = { games: "event_id", teams: "team_id", players: "player_id" }[kind];
  if (!field || !id) return null;
  const combos = [...(meta.combos || [])].sort((a,b) => (b.season === preferredSeason) - (a.season === preferredSeason) || (b.group === preferredGroup) - (a.group === preferredGroup) || (genderForGroup(b.season,b.group) === preferredGender) - (genderForGroup(a.season,a.group) === preferredGender) || b.season-a.season);
  return combos.find((c) => (kind !== "players" || c.season === preferredSeason) && (kind === "players" ? playerIndex[`${c.season}/${c.group}`] || RAW[`${c.season}/${c.group}/${kind}`] : RAW[`${c.season}/${c.group}/${kind}`])?.some((x) => x[field] === id)) || null;
}
export function seasonGroups(seasonId, gender = null) {
  return (meta.groups || []).filter((g) => g.season_id === seasonId && (!gender || groupGender(g.name) === gender)).sort(groupAgeSort);
}

export function seasonName(seasonId) {
  const s = (meta.seasons || []).find((x) => x.season_id === seasonId);
  return s ? s.name : `Season ${seasonId}`;
}

/* The season picker has to fit a phone next to the group picker. Full names run
 * to “第31屆驍籃青少年籃球聯賽”; the meaningful head is “第31屆驍籃”, so cut at
 * the league-name tail (and fall back to the full name if a future season is
 * named differently). */
export function seasonShortName(seasonId) {
  return seasonName(seasonId).replace(/青少年.*$/, "").trim();
}

export function groupName(seasonId, groupId) {
  const g = (meta.groups || []).find((x) => x.season_id === seasonId && x.group_id === groupId);
  return g ? g.name : "";
}

/* Visible scope label: “YOUTH GIRLS U13 · SEASON 33”. Group names are stored
 * without the season, so the season has to be appended for the label to mean
 * anything when someone lands on a shared URL. */
export function scopeLabel(seasonId, groupId) {
  const name = groupName(seasonId, groupId);
  return [name, `SEASON ${seasonId}`].filter(Boolean).join(" · ");
}

export function groupsForCombine(seasonId, groupId) {
  const groups = seasonGroups(seasonId);
  if (!groups.length) return groups;
  if (groups.some((g) => g.group_id === groupId)) return groups;
  return groups;
}

/* ---------------- global search (players / teams / games) ---------------- */

const searchIndexes = new Map();

export function buildSearchIndex(gender = "girls") {
  if (searchIndexes.has(gender)) return searchIndexes.get(gender);
  const players = [], teams = [], games = [];
  for (const combo of meta.combos || []) {
    if (genderForGroup(combo.season, combo.group) !== gender) continue;
    let p, t, g;
    try {
      p = playerIndex[`${combo.season}/${combo.group}`] || api("players", { season: combo.season, group: combo.group });
      t = api("teams", { season: combo.season, group: combo.group });
      g = api("games", { season: combo.season, group: combo.group });
    } catch (e) {
      continue;
    }
    const gr = meta.groups.find((x) => x.season_id === combo.season && x.group_id === combo.group) || {};
    const ctx = `${combo.season} · ${gr.name || "group " + combo.group}`;
    for (const x of p) players.push({ name: x.player_name, sub: `${x.team_name} · ${ctx}`, href: `#/players/${x.player_id}`, season: combo.season, group: combo.group });
    for (const x of t) teams.push({ name: x.team_name, sub: ctx, href: `#/teams/${x.team_id}`, season: combo.season, group: combo.group });
    for (const x of g) games.push({
      name: `${x.home_name} vs ${x.away_name}`,
      sub: `${x.game_date}${x.venue ? ` · ${x.venue}` : ""} · ${ctx}`,
      href: `#/games/${x.event_id}`,
      season: combo.season,
      group: combo.group,
    });
  }
  const index = { players, teams, games };
  searchIndexes.set(gender, index);
  return index;
}

/* Relevance order for the global search box (UX-04). Explicit and stable:
 *
 *   scope 0  the season + group the dashboard is currently showing
 *   scope 1  other groups of the current season
 *   scope 2  older (and any other) seasons
 *
 * and inside one scope tier:
 *
 *   quality 0  exact, case-insensitive name match
 *   quality 1  name starts with the query
 *   quality 2  name contains the query
 *   quality 3  fixture sub-line contains the query (games only)
 *
 * Remaining ties: shorter name, then kind order team → player → game, then the
 * index's own insertion order (season, group, payload order) so repeated
 * keystrokes never reshuffle equal results. `ctx` is optional; without it every
 * result lands in scope 2 and is ordered by match quality alone.
 *
 * `query=""` returns nothing (the box only searches from two characters up).
 * The 30-result cap is a hard contract with the dropdown layout. */
const KIND_ORDER = { team: 0, player: 1, game: 2 };

export function searchMatches(idx, q, ctx = null) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return [];
  const season = ctx?.season ?? null;
  const group = ctx?.group ?? null;
  const scored = [];
  const consider = (kind, row, order, matchSub) => {
    const name = String(row.name || "").toLowerCase();
    let quality = -1;
    if (name === needle) quality = 0;
    else if (name.startsWith(needle)) quality = 1;
    else if (name.includes(needle)) quality = 2;
    else if (matchSub && String(row.sub || "").toLowerCase().includes(needle)) quality = 3;
    if (quality < 0) return;
    let scope = 2;
    if (season != null) {
      if (group != null && row.season === season && row.group === group) scope = 0;
      else if (row.season === season) scope = 1;
    }
    scored.push({ kind, label: row.name, sub: row.sub, href: row.href, season: row.season, group: row.group, scope, quality, order });
  };
  idx.players.forEach((p, i) => consider("player", p, i, false));
  idx.teams.forEach((t, i) => consider("team", t, i, false));
  idx.games.forEach((g, i) => consider("game", g, i, true));
  scored.sort(
    (a, b) =>
      a.scope - b.scope ||
      a.quality - b.quality ||
      a.label.length - b.label.length ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.order - b.order
  );
  return scored.slice(0, 30).map(({ kind, label, sub, href, season: s, group: g }) => ({
    kind,
    label,
    sub,
    href,
    season: s,
    group: g,
  }));
}
