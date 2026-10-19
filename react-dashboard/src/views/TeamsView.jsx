import { useEffect, useState } from "react";
import { api, groupName } from "../data.js";
import { csvDownload, setTitle, sortRows } from "../utils.js";
import { CsvButton } from "../components/Buttons.jsx";
import SortTable from "../components/SortTable.jsx";

const KEYS = [
  { key: "team_name", label: "Team" },
  { key: "gp", label: "GP", num: true },
  { key: "wins", label: "W", num: true },
  { key: "losses", label: "L", num: true },
  { key: "pts_for", label: "PF", num: true },
  { key: "pts_against", label: "PA", num: true },
  { key: "diff", label: "±", num: true },
  { key: "manager", label: "Manager" },
  { key: "captain_name", label: "Captain" },
];

export default function TeamsView({ ctx }) {
  const [sort, setSort] = useState(null);
  const teams = api("teams", ctx);

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Teams", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  const rows = sort ? sortRows(teams, sort.key, sort.dir) : teams;

  const downloadCsv = () =>
    csvDownload(
      "teams.csv",
      ["Team", "GP", "W", "L", "PF", "PA", "+/-", "Manager", "Captain"],
      teams.map((t) => [t.team_name, t.gp, t.wins, t.losses, t.pts_for, t.pts_against, t.diff, t.manager, t.captain_name])
    );

  return (
    <>
      <div className="view-head">
        <h2>Teams</h2>
        <div className="toolbar">
          <div className="sub">{teams.length} teams · season {ctx.season}</div>
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>
      <div className="card">
        <div id="teams-table">
          <SortTable
            columns={KEYS}
            rows={rows}
            tableId="t-teams"
            pin={1}
            sort={sort}
            onSort={setSort}
            rowKey={(t) => t.team_id}
            rowHref={(t) => `#/teams/${t.team_id}`}
            renderRow={(t) => [
              <td key="team"><a className="row-link" href={`#/teams/${t.team_id}`}>{t.team_name}</a></td>,
              <td className="num" key="gp">{t.gp}</td>,
              <td className="num" key="w">{t.wins}</td>,
              <td className="num" key="l">{t.losses}</td>,
              <td className="num" key="pf">{t.pts_for}</td>,
              <td className="num" key="pa">{t.pts_against}</td>,
              <td className={`num ${t.diff >= 0 ? "winner" : "loser"}`} key="diff">
                {t.diff > 0 ? "+" + t.diff : t.diff}
              </td>,
              <td key="manager">{t.manager}</td>,
              <td key="captain">{t.captain_name || "—"}</td>,
            ]}
          />
        </div>
      </div>
    </>
  );
}
