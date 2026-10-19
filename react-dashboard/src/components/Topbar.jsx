import { groupName, meta, seasonGroups, seasonName } from "../data.js";
import SearchBox from "./SearchBox.jsx";

export default function Topbar({ ctx, theme, onToggleTheme, onSeasonChange, onGroupChange, onAdoptContext }) {
  const groups = seasonGroups(ctx.season);
  const themeLabel = theme === "light" ? "Dark mode" : "Light mode";
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo" aria-hidden="true">HL</div>
        <div>
          <h1>Hillen League</h1>
          <p id="meta-line" className="meta-line">
            {`${seasonName(ctx.season)} · ${groupName(ctx.season, ctx.group) || "Group " + ctx.group}`}
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
          <select id="season-select" value={ctx.season} onChange={(e) => onSeasonChange(+e.target.value)}>
            {(meta.seasons || []).map((s) => (
              <option key={s.season_id} value={s.season_id}>{`${s.season_id} · ${s.name}`}</option>
            ))}
          </select>
        </label>
        <label htmlFor="group-select">
          Group
          <select id="group-select" value={ctx.group} onChange={(e) => onGroupChange(+e.target.value)}>
            {groups.map((g) => (
              <option key={g.group_id} value={g.group_id}>{g.name}</option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
