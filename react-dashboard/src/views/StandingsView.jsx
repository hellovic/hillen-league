import { useEffect, useState } from "react";
import { api, groupName } from "../data.js";
import { csvDownload, fmtDate, go, setTitle, sortRows } from "../utils.js";
import { ShareButton, CsvButton } from "../components/Buttons.jsx";
import SortTable from "../components/SortTable.jsx";

const KEYS = [
  { key: "pos", label: "#", num: true },
  { key: "team_name", label: "Team" },
  { key: "gp", label: "GP", num: true },
  { key: "wins", label: "W", num: true },
  { key: "losses", label: "L", num: true },
  { key: "forfeits", label: "F", num: true },
  { key: "diff", label: "±", num: true },
  { key: "points", label: "Pts", num: true },
];

export default function StandingsView({ ctx }) {
  const [sort, setSort] = useState(null);
  const [standings, teams, games] = [api("standings", ctx), api("teams", ctx), api("games", ctx)];

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Standings", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  const maxPf = Math.max(...teams.map((t) => t.pts_for), 1);
  const played = games.filter((g) => g.status === "completed");
  const rows = sort ? sortRows(standings, sort.key, sort.dir) : standings;

  const downloadCsv = () =>
    csvDownload(
      "standings.csv",
      ["Rank", "Team", "GP", "W", "L", "F", "+/-", "Points"],
      standings.map((s) => [s.pos ?? s.rank, s.team_name, s.gp, s.wins, s.losses, s.forfeits, s.diff, s.points])
    );

  return (
    <>
      <div className="view-head">
        <h2>Standings</h2>
        <div className="toolbar">
          <div className="sub">{teams.length} teams · {played.length} played</div>
          <ShareButton kind="groups" id={`${ctx.season}/${ctx.group}`} />
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Group Table</h3>
          <div id="st-table">
            <SortTable
              columns={KEYS}
              rows={rows}
              tableId="t-standings"
              pin={2}
              sort={sort}
              onSort={setSort}
              rowKey={(s) => s.team_id}
              rowHref={(s) => `#/teams/${s.team_id}`}
              renderRow={(s) => [
                <td className="num" key="pos">{s.pos ?? s.rank}</td>,
                <td key="team"><a className="row-link" href={`#/teams/${s.team_id}`}>{s.team_name}</a></td>,
                <td className="num" key="gp">{s.gp}</td>,
                <td className="num" key="w">{s.wins}</td>,
                <td className="num" key="l">{s.losses}</td>,
                <td className="num" key="f">{s.forfeits}</td>,
                <td className={`num ${s.diff === null ? "" : s.diff >= 0 ? "winner" : "loser"}`} key="diff">
                  {s.diff === null ? "—" : s.diff > 0 ? "+" + s.diff : s.diff}
                </td>,
                <td className="num" key="pts">{s.points}</td>,
              ]}
            />
          </div>
        </div>
        <div>
          <div className="card">
            <h3>Points for / against</h3>
            {teams.map((t) => (
              <div className="bar-row" key={t.team_id}>
                <span className="bl"><a className="row-link" href={`#/teams/${t.team_id}`}>{t.team_name}</a></span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max((t.pts_for / maxPf) * 100, 2)}%` }} />
                </div>
                <span className="bv">{t.pts_for}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <h3>Latest results</h3>
            {games.slice(-5).reverse().map((g) => (
              <div
                className="bar-row"
                key={g.event_id}
                style={{ cursor: "pointer" }}
                onClick={() => go(`#/games/${g.event_id}`)}
              >
                <span className="bl" style={{ width: "100%" }}>
                  {fmtDate(g.game_date)} · {g.home_name} {g.home_score ?? "—"}–{g.away_score ?? "—"} {g.away_name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
