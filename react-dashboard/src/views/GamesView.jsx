import { useEffect, useState } from "react";
import { api, groupName } from "../data.js";
import { csvDownload, setTitle, sortRows } from "../utils.js";
import { CsvButton } from "../components/Buttons.jsx";
import CompactDate from "../components/CompactDate.jsx";
import SortTable from "../components/SortTable.jsx";

const KEYS = [
  { key: "game_date", label: "Date" },
  { key: "home_name", label: "Home" },
  { key: "home_score", label: "Score", num: true },
  { key: "away_name", label: "Away" },
  { key: "venue", label: "Venue" },
  { key: "status", label: "Status" },
];

function StatusBadge({ status }) {
  if (status === "completed") return <span className="badge w">played</span>;
  if (status === "forfeit") return <span className="badge l">forfeit</span>;
  if (status === "not_played") return <span className="badge np">not played</span>;
  return <span className="badge np">scheduled</span>;
}

export default function GamesView({ ctx }) {
  const [sort, setSort] = useState(null);
  const games = api("games", ctx);
  const played = games.filter((g) => g.status === "completed");

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Games", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  const rows = sort ? sortRows(games, sort.key, sort.dir) : games;

  const downloadCsv = () =>
    csvDownload(
      "games.csv",
      ["Date", "Home", "Score", "Away", "Venue", "Status"],
      games.map((g) => [
        g.game_date, g.home_name,
        g.status === "completed" ? `${g.home_score}-${g.away_score}` : "",
        g.away_name, g.venue, g.status,
      ])
    );

  return (
    <>
      <div className="view-head">
        <h2>Games</h2>
        <div className="toolbar">
          <div className="sub">{games.length} scheduled · {played.length} completed</div>
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>
      <div className="card">
        <div id="games-table">
          <SortTable
            columns={KEYS}
            rows={rows}
            tableId="t-games"
            pin={1}
            sort={sort}
            onSort={setSort}
            rowKey={(g) => g.event_id}
            rowHref={(g) => `#/games/${g.event_id}`}
            renderRow={(g) => [
              <td className="game-date-cell" key="date">
                <CompactDate date={g.game_date} time={g.start_time || ""} />
              </td>,
              <td key="home"><a className="row-link" href={`#/teams/${g.home_team_id}`}>{g.home_name}</a></td>,
              <td className="num mono" key="score">
                {g.status === "completed" ? `${g.home_score}–${g.away_score}` : "—"}
              </td>,
              <td key="away"><a className="row-link" href={`#/teams/${g.away_team_id}`}>{g.away_name}</a></td>,
              <td key="venue">{g.venue || "—"}</td>,
              <td key="status"><StatusBadge status={g.status} /></td>,
            ]}
          />
        </div>
      </div>
    </>
  );
}
