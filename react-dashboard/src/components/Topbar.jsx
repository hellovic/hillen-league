import { groupName, seasonGroups, seasonName, seasonShortName, seasonsForGender } from "../data.js";
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

export default function Topbar({ ctx, theme, allGroups = false, onGenderChange, onToggleTheme, onSeasonChange, onGroupChange, onAdoptContext }) {
  const isPhone = useIsPhone();
  const groups = seasonGroups(ctx.season,ctx.gender);
  const isLight = theme === "light";
  const themeLabel = isLight ? "Switch to dark mode" : "Switch to light mode";

  const seasonOptions = seasonsForGender(ctx.gender).map((s) => (
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
              ? `${seasonName(ctx.season)} · ${ctx.gender === "boys" ? "Boys" : "Girls"} · All groups`
              : `${seasonName(ctx.season)} · ${groupName(ctx.season, ctx.group) || "Group " + ctx.group}`}
          </p>
        </div>
      </div>
      <div className="header-tools">
      <div className="gender-switch" role="group" aria-label="League division">
        {["girls","boys"].map((gender) => <button key={gender} id={`gender-${gender}`} type="button" aria-pressed={ctx.gender === gender} onClick={() => onGenderChange(gender)}>{gender === "girls" ? "Girls" : "Boys"}</button>)}
      </div>
      <button
        className="theme-toggle"
        id="theme-toggle"
        type="button"
        aria-label={themeLabel}
        aria-pressed={isLight}
        title={themeLabel}
        onClick={onToggleTheme}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {isLight ? <path d="M20.5 15.2A8.8 8.8 0 0 1 8.8 3.5a9 9 0 1 0 11.7 11.7Z" /> : (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
            </>
          )}
        </svg>
      </button>
      </div>
      <div className="controls">
        <SearchBox key={ctx.gender} ctx={ctx} onAdoptContext={onAdoptContext} />
        <select
          id="season-select"
          aria-label="Season"
          title={seasonName(ctx.season)}
          value={ctx.season}
          onChange={(e) => onSeasonChange(+e.target.value)}
        >
          {seasonOptions}
        </select>
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
