import { groupName, meta, seasonGroups, seasonName, seasonShortName } from "../data.js";
import SearchBox from "./SearchBox.jsx";
import { useIsPhone } from "../useMediaQuery.js";

/* Header for every view.
 *
 * Both pickers are always visible and apply on change — on a phone they sit on
 * their own row under the search field (owner preference, 2026-10-19: changing
 * season or group should not need a popup). The season overview replaces the
 * group picker with a static "All groups" marker, because that page is
 * season-wide; the picker only appears on group-scoped pages. */
/* “YOUTH GIRLS U13” → “GIRLS U13”, “YOUTH GIRLS U11 GROUP A” → “GIRLS U11 A”.
 * The phone selects sit side by side, so the options drop only the “YOUTH”
 * prefix — never “GIRLS”, because boys' groups will appear in the same league.
 * The select's title attribute still carries the full name. */
function shortGroup(seasonId, groupId) {
  const name = groupName(seasonId, groupId) || `Group ${groupId}`;
  return name
    .replace(/^YOUTH\s+/i, "")
    .replace(/^GROUP\s+/i, "")
    .replace(/^(GIRLS\s+U\d+)\s+GROUP\s+([A-Z])$/i, "$1 $2");
}

export default function Topbar({ ctx, theme, allGroups = false, onToggleTheme, onSeasonChange, onGroupChange, onAdoptContext }) {
  const isPhone = useIsPhone();
  const groups = seasonGroups(ctx.season);
  const themeLabel = theme === "light" ? "Dark mode" : "Light mode";

  const seasonOptions = (meta.seasons || []).map((s) => (
    <option key={s.season_id} value={s.season_id}>
      {`${s.season_id} · ${seasonShortName(s.season_id)}`}
    </option>
  ));
  const groupOptions = groups.map((g) => (
    <option key={g.group_id} value={g.group_id}>
      {isPhone ? shortGroup(ctx.season, g.group_id) : g.name}
    </option>
  ));

  return (
    <header className={`topbar${isPhone ? " compact" : ""}`}>
      <div className="brand">
        <div className="logo" aria-hidden="true">HL</div>
        <div>
          <h1>Hillen League</h1>
          <p id="meta-line" className="meta-line">
            {allGroups
              ? `${seasonName(ctx.season)} · All groups`
              : `${seasonName(ctx.season)} · ${groupName(ctx.season, ctx.group) || "Group " + ctx.group}`}
          </p>
        </div>
      </div>
      <button
        className="theme-toggle"
        id="theme-toggle"
        type="button"
        aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        aria-pressed={theme === "light"}
        onClick={onToggleTheme}
      >
        {isPhone ? (theme === "light" ? "Dark" : "Light") : themeLabel}
      </button>
      <div className="controls">
        <SearchBox ctx={ctx} onAdoptContext={onAdoptContext} />
        <label htmlFor="season-select">
          Season
          {/* Short label (“31 · 第31屆驍籃”) so the picker stays narrow and the
            * Group picker gets the remaining width; the full name is the tooltip. */}
          <select
            id="season-select"
            title={seasonName(ctx.season)}
            value={ctx.season}
            onChange={(e) => onSeasonChange(+e.target.value)}
          >
            {seasonOptions}
          </select>
        </label>
        {allGroups ? (
          <span className="all-groups-pill" title="This page shows every group in the season">
            All groups
          </span>
        ) : (
          <label htmlFor="group-select">
            Group
            <select
              id="group-select"
              title={groupName(ctx.season, ctx.group)}
              value={ctx.group}
              onChange={(e) => onGroupChange(+e.target.value)}
            >
              {groupOptions}
            </select>
          </label>
        )}
      </div>
    </header>
  );
}
