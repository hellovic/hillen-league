import { useT } from "../locale.jsx";
import { contextHash, go, seasonHash } from "../utils.js";

const TABS = [
  ["season", "Overview"],
  ["standings", "Standings"],
  ["teams", "Teams"],
  ["players", "Players"],
  ["games", "Games"],
  ["leaders", "Leaders"],
  ["compare", "Compare"],
  ["player-story", "Story"],
];

export default function Tabs({ active, ctx }) {
  const tr = useT();
  return (
    <nav className="tabs" id="tabs" aria-label={tr("League navigation")}>
      {TABS.map(([view, label]) => (
        <button
          key={view}
          type="button"
          data-view={view}
          aria-current={active === view ? "page" : undefined}
          className={active === view ? "active" : undefined}
          onClick={() => go(view === "season" ? seasonHash(ctx.season, ctx.gender) : contextHash(view, ctx))}
        >
          {tr(label)}
        </button>
      ))}
    </nav>
  );
}
