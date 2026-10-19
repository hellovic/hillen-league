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
