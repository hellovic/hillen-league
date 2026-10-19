/* Data access for the React dashboard.
 *
 * The OD build embeds every payload inline as `window.LEAGUE_DATA`, keyed exactly
 * like the static JSON export: `meta`, `season/<id>` and
 * `<season>/<group>/<path>`. Reads are synchronous, so views render in one pass
 * without a fetch waterfall. */

const RAW = (typeof window !== "undefined" && window.LEAGUE_DATA) || {};

export const meta = RAW.meta || { seasons: [], groups: [], combos: [] };
export const DEFAULT_SEASON = meta.default_season ?? meta.seasons?.[0]?.season_id ?? 33;
export const DEFAULT_GROUP = meta.default_group ?? 16;

/* Same lookup rules as the vanilla app: context defaults, plus a cross-group /
 * cross-season fallback for detail payloads whose id is globally unique. */
export function api(path, params = {}) {
  const s = params.season ?? DEFAULT_SEASON;
  const g = params.group ?? DEFAULT_GROUP;
  const key = path === "meta" ? "meta" : path === "season" ? `season/${s}` : `${s}/${g}/${path}`;
  let value = RAW[key];
  if (value === undefined && /^(games|teams|players)\//.test(path) && !params.group) {
    const combos = [...(meta.combos || [])].sort(
      (a, b) => (b.season === s) - (a.season === s) || b.season - a.season
    );
    for (const c of combos) {
      if (path.startsWith("players/") && c.season !== s) continue;
      value = RAW[`${c.season}/${c.group}/${path}`];
      if (value !== undefined) break;
    }
  }
  if (value === undefined) throw new Error("No data available for this selection");
  return value;
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
export function seasonGroups(seasonId) {
  return (meta.groups || []).filter((g) => g.season_id === seasonId).sort(groupAgeSort);
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

export function groupsForCombine(seasonId, groupId) {
  const groups = seasonGroups(seasonId);
  if (!groups.length) return groups;
  if (groups.some((g) => g.group_id === groupId)) return groups;
  return groups;
}

/* ---------------- global search (players / teams / games) ---------------- */

let searchIndex = null;

export function buildSearchIndex() {
  if (searchIndex) return searchIndex;
  const players = [], teams = [], games = [];
  for (const combo of meta.combos || []) {
    let p, t, g;
    try {
      p = api("players", { season: combo.season, group: combo.group });
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
  searchIndex = { players, teams, games };
  return searchIndex;
}

export function searchMatches(idx, q) {
  const needle = q.toLowerCase();
  const out = [];
  for (const p of idx.players) if (p.name.toLowerCase().includes(needle)) out.push({ kind: "player", label: p.name, sub: p.sub, href: p.href, season: p.season, group: p.group });
  for (const t of idx.teams) if (t.name.toLowerCase().includes(needle)) out.push({ kind: "team", label: t.name, sub: t.sub, href: t.href, season: t.season, group: t.group });
  for (const g of idx.games) if (g.name.toLowerCase().includes(needle) || g.sub.toLowerCase().includes(needle)) out.push({ kind: "game", label: g.name, sub: g.sub, href: g.href, season: g.season, group: g.group });
  return out.slice(0, 30);
}
