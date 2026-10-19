import { useEffect } from "react";
import { api, groupName, scopeLabel } from "../data.js";
import { contextHash, csvDownload, go, hasResult, setTitle } from "../utils.js";
import { CsvButton } from "../components/Buttons.jsx";
import ScopeEmpty from "../components/ScopeEmpty.jsx";

const ORDER = ["mvp", "pts", "ast", "reb", "fg3", "blk", "ft", "stl"];

/* Group leaderboards. A group with no final/forfeit game has nothing to rank
 * (the bundle would otherwise serve eight all-zero tables), so it gets one
 * explanation and a link to the fixtures instead (UX-03 / UX-19). */
export default function LeadersView({ ctx }) {
  let leaders = [];
  try {
    leaders = api("leaders", ctx) || [];
  } catch (e) {
    leaders = [];
  }
  let teams = [];
  let games = [];
  try {
    teams = api("teams", ctx) || [];
    games = api("games", ctx) || [];
  } catch (e) {
    teams = [];
    games = [];
  }
  const resolved = games.filter(hasResult);

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Leaders", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  /* Empty group (no teams) and no-results group are different facts. */
  if (!teams.length) {
    return (
      <>
        <div className="view-head">
          <div className="view-head-copy">
            <p className="eyebrow">{scopeLabel(ctx.season, ctx.group)}</p>
            <h2>Leaders</h2>
          </div>
        </div>
        <div className="card">
          <ScopeEmpty
            title="No teams in this group yet"
            text="Leaderboards appear once the group is drawn and results are recorded."
            href={"#/standings?season=" + ctx.season + "&group=" + ctx.group}
            linkLabel="View standings ↗"
          />
        </div>
      </>
    );
  }

  if (!resolved.length || !leaders.length) {
    return (
      <>
        <div className="view-head">
          <div className="view-head-copy">
            <p className="eyebrow">{scopeLabel(ctx.season, ctx.group)}</p>
            <h2>Leaders</h2>
          </div>
        </div>
        <div className="card">
          <ScopeEmpty
            title={resolved.length ? "No leaderboards yet" : "No games played yet"}
            text={
              resolved.length
                ? "This group has results but no leaderboard rows in the data bundle yet."
                : "Leaderboards appear after the first final. Until then this group has no stats to rank."
            }
            href={contextHash("games", ctx)}
            linkLabel="View fixtures ↗"
          />
        </div>
      </>
    );
  }

  const prio = (c) => {
    const i = ORDER.indexOf(c);
    return i === -1 ? ORDER.length + c : i;
  };
  const sorted = [...leaders].sort((a, b) => prio(a.category) - prio(b.category) || a.rank - b.rank);
  const cats = [];
  let cur = null;
  for (const r of sorted) {
    if (!cur || cur.key !== r.category) {
      cur = { key: r.category, cn: r.category_cn, items: [] };
      cats.push(cur);
    }
    cur.items.push(r);
  }

  const downloadCsv = () =>
    csvDownload(
      "leaders.csv",
      ["Category", "Rank", "Player", "Team", "GP", "Total", "Avg"],
      sorted.map((r) => [r.category_cn, r.rank, r.player_name, r.team_name, r.games_played, r.total, r.avg])
    );

  return (
    <>
      <div className="view-head">
        <div className="view-head-copy">
          <p className="eyebrow">{scopeLabel(ctx.season, ctx.group)}</p>
          <h2>Leaders</h2>
        </div>
        <div className="toolbar">
          <div className="sub">
            {cats.length} categories · {resolved.length} played · {groupName(ctx.season, ctx.group)}
          </div>
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>
      <div className="grid-2">
        {cats.map((cat) => (
          <div className="card leaderboard-card" key={cat.key}>
            <h3>{cat.cn} <span className="cn">{cat.key}</span></h3>
            <table className="data leaderboard-table">
              <thead>
                <tr>
                  <th className="num">#</th><th>Player</th><th>Team</th>
                  <th className="num">GP</th><th className="num">Total</th><th className="num">Avg</th>
                </tr>
              </thead>
              <tbody>
                {cat.items.map((r) => (
                  <tr
                    key={`${r.category}-${r.rank}-${r.player_id}`}
                    tabIndex={0}
                    data-href={`#/players/${r.player_id}`}
                    onClick={(e) => {
                      if (e.target.closest("a")) return;
                      go(`#/players/${r.player_id}`);
                    }}
                  >
                    <td className="num">{r.rank}</td>
                    <td><a className="row-link" href={`#/players/${r.player_id}`}>{r.player_name}</a></td>
                    <td>
                      <a className="row-link" style={{ color: "var(--muted)" }} href={`#/teams/${r.team_id}`}>{r.team_name}</a>
                    </td>
                    <td className="num">{r.games_played ?? "—"}</td>
                    <td className="num">{r.total ?? "—"}</td>
                    <td className="num">{r.avg ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
