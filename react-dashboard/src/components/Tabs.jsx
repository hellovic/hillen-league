import { contextHash, go, seasonHash } from "../utils.js";

const TABS = [
  ["season", "Overview"],
  ["standings", "Standings"],
  ["teams", "Teams"],
  ["players", "Players"],
  ["games", "Games"],
  ["leaders", "Leaders"],
  ["compare", "Compare"],
];

export default function Tabs({ active, ctx }) {
  return (
    <nav className="tabs" id="tabs" aria-label="League navigation">
      {TABS.map(([view, label]) => (
        <button
          key={view}
          type="button"
          data-view={view}
          className={active === view ? "active" : undefined}
          onClick={() => go(view === "season" ? seasonHash(ctx.season) : contextHash(view, ctx))}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
