import { useEffect, useRef, useState } from "react";
import { groupName, meta, seasonGroups, seasonName, seasonShortName } from "../data.js";
import SearchBox from "./SearchBox.jsx";
import { useIsPhone } from "../useMediaQuery.js";

/* “YOUTH GIRLS U13” → “U13”, “YOUTH GIRLS U11 GROUP A” → “U11 A”. The phone
 * filter chip has room for a short group token, not the full division name. */
function shortGroup(seasonId, groupId) {
  const name = groupName(seasonId, groupId) || `Group ${groupId}`;
  return name
    .replace(/^YOUTH GIRLS?\s+/i, "")
    .replace(/^GROUP\s+/i, "")
    .replace(/^U(\d+)\s+GROUP\s+([A-Z])$/i, "U$1 $2");
}

export default function Topbar({ ctx, theme, allGroups = false, onToggleTheme, onSeasonChange, onGroupChange, onAdoptContext }) {
  const isPhone = useIsPhone();
  const groups = seasonGroups(ctx.season);
  const themeLabel = theme === "light" ? "Dark mode" : "Light mode";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef(null);

  /* The compact panel is a disclosure, not a modal: close it when the context
   * changes or the user taps outside / presses Escape. */
  useEffect(() => setFiltersOpen(false), [ctx.season, ctx.group]);
  useEffect(() => {
    if (!filtersOpen) return;
    const onDoc = (e) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const seasonOptions = (meta.seasons || []).map((s) => (
    <option key={s.season_id} value={s.season_id}>
      {`${s.season_id} · ${seasonShortName(s.season_id)}`}
    </option>
  ));
  const groupOptions = groups.map((g) => (
    <option key={g.group_id} value={g.group_id}>{g.name}</option>
  ));

  if (isPhone) {
    /* Compact phone header (UX-14): brand + theme on one 44 px row, then a
     * full-height search field next to a filter chip that summarises the
     * current season/group and opens the two selects on demand. The desktop
     * selects stay in the header on wider screens. */
    return (
      <header className="topbar compact">
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
          {theme === "light" ? "Dark" : "Light"}
        </button>
        <div className="controls">
          <SearchBox ctx={ctx} onAdoptContext={onAdoptContext} />
          <div className="filter-wrap" ref={filtersRef}>
            <button
              type="button"
              className="filter-chip"
              id="filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls="filter-panel"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <span className="chip-season">S{ctx.season}</span>
              <span className="chip-group">
                {allGroups ? "All groups" : shortGroup(ctx.season, ctx.group)}
              </span>
              <span className="chip-caret" aria-hidden="true">▾</span>
            </button>
            <div
              className={`filter-panel${filtersOpen ? " open" : ""}`}
              id="filter-panel"
              role="group"
              aria-label="Season and group filters"
              hidden={!filtersOpen}
            >
              <label htmlFor="season-select">
                Season
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
                <p className="filter-note">The overview covers every group in this season.</p>
              ) : (
                <label htmlFor="group-select">
                  Group
                  <select id="group-select" value={ctx.group} onChange={(e) => onGroupChange(+e.target.value)}>
                    {groupOptions}
                  </select>
                </label>
              )}
              <button type="button" className="filter-done" onClick={() => setFiltersOpen(false)}>
                {allGroups ? "Show season" : `Show ${shortGroup(ctx.season, ctx.group)}`}
              </button>
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="topbar">
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
        aria-label="Switch theme"
        aria-pressed={theme === "light"}
        onClick={onToggleTheme}
      >
        {themeLabel}
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
            <select id="group-select" value={ctx.group} onChange={(e) => onGroupChange(+e.target.value)}>
              {groupOptions}
            </select>
          </label>
        )}
      </div>
    </header>
  );
}
