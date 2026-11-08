import { useT } from "../locale.jsx";
import { useEffect, useState } from "react";
import { contextHash, go, seasonHash } from "../utils.js";

/* Six bottom-bar destinations, in the order Vic asked for:
 * Overview · Standings · Story · Leaders · Compare · More (Teams, Players, Games).
 * The desktop rail keeps all views visible.
 * The first destination is called “Overview” on both breakpoints (UX-12), and
 * an active nested page marks the More control with aria-current plus a
 * visible dot, so the nested destination is discoverable (UX-12/UX-16). */
const PRIMARY = [
  ["season", "Overview"],
  ["standings", "Standings"],
  ["player-story", "Story"],
  ["leaders", "Leaders"],
  ["compare", "Compare"],
];
const MORE = [["teams", "Teams"], ["players", "Players"], ["games", "Games"]];

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
function IconStory() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 6c-2.5-2-6-2-9-1v14c3-1 6.5-1 9 1 2.5-2 6-2 9-1V5c-3-1-6.5-1-9 1Zm0 0v14" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 01-8 0V4Z" />
      <path d="M8 5H5v2a3 3 0 003 3M16 5h3v2a3 3 0 01-3 3" />
      <path d="M12 13v4M9 20h6" />
    </svg>
  );
}
function IconCompare() {
  return (
    <svg className="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
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

const ICONS = {
  season: IconGrid,
  standings: IconBars,
  "player-story": IconStory,
  leaders: IconTrophy,
  compare: IconCompare,
};

/* The dot is a non-colour selected cue (UX-16): it is shown on the current
 * destination and on More when a nested page is current. */
function SelectedDot({ visible }) {
  return (
    <span className="nav-dot" aria-hidden="true" data-visible={visible ? "true" : "false"} />
  );
}

export default function MobileNav({ active, ctx }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [active, ctx.season, ctx.group]);

  const pick = (view) => {
    setOpen(false);
    go(view === "season" ? seasonHash(ctx.season, ctx.gender) : contextHash(view, ctx));
  };
  const inMore = MORE.some(([view]) => view === active);

  return (
    <nav className="mobile-nav" id="mobile-nav" aria-label={tr("League navigation")}>
      {PRIMARY.map(([view, label]) => {
        const Icon = ICONS[view];
        return (
          <button
            key={view}
            type="button"
            data-go={view}
            aria-current={active === view ? "page" : undefined}
            onClick={() => pick(view)}
          >
            <Icon />
            <span className="nav-label">{tr(label)}</span>
            <SelectedDot visible={active === view} />
          </button>
        );
      })}
      <details
        id="more-nav"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
        className={inMore ? "nav-more-current" : undefined}
      >
        <summary aria-current={inMore ? "page" : undefined}>
          <IconMore />
          <span className="nav-label">{tr("More")}</span>
          <SelectedDot visible={inMore} />
        </summary>
        <div className="more-menu">
          {MORE.map(([view, label]) => (
            <button
              key={view}
              type="button"
              data-go={view}
              aria-current={active === view ? "page" : undefined}
              onClick={() => pick(view)}
            >
              <span className="nav-label">{tr(label)}</span>
              <SelectedDot visible={active === view} />
            </button>
          ))}
        </div>
      </details>
    </nav>
  );
}
