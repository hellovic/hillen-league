import { useEffect, useState } from "react";
import { contextHash, go, seasonHash } from "../utils.js";

const PRIMARY = [["season", "Overview"], ["standings", "Standings"], ["games", "Games"], ["teams", "Teams"]];
const MORE = [["players", "Players"], ["leaders", "Leaders"], ["compare", "Compare"]];

function IconGrid() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}
function IconBars() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5 21V12h4v9M10 21V4h4v17M15 21V8h4v13" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18" />
    </svg>
  );
}
function IconPeople() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="9" cy="8" r="3" /><path d="M3 21v-4a6 6 0 0112 0v4M16 5a3 3 0 010 6m2 3a5 5 0 013 4v3" />
    </svg>
  );
}
function IconMore() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
    </svg>
  );
}

const ICONS = { season: IconGrid, standings: IconBars, games: IconCalendar, teams: IconPeople };

export default function MobileNav({ active, ctx }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [active, ctx.season, ctx.group]);

  const pick = (view) => {
    setOpen(false);
    go(view === "season" ? seasonHash(ctx.season) : contextHash(view, ctx));
  };

  return (
    <nav className="mobile-nav" id="mobile-nav" aria-label="League navigation">
      {PRIMARY.map(([view, label]) => {
        const Icon = ICONS[view];
        return (
          <button
            key={view}
            type="button"
            data-go={view}
            aria-current={active === view ? "page" : "false"}
            onClick={() => pick(view)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        );
      })}
      <details id="more-nav" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <IconMore />
          <span>More</span>
        </summary>
        <div className="more-menu">
          {MORE.map(([view, label]) => (
            <button
              key={view}
              type="button"
              data-go={view}
              aria-current={active === view ? "page" : "false"}
              onClick={() => pick(view)}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
    </nav>
  );
}
