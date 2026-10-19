import { useEffect, useState } from "react";
import { api, groupName, scopeLabel } from "../data.js";
import {
  contextHash,
  csvDownload,
  fmtDate,
  gameStatus,
  hasResult,
  scoreText,
  setTitle,
  sortByKickoff,
  sortRows,
} from "../utils.js";
import { ShareButton, CsvButton } from "../components/Buttons.jsx";
import SortTable from "../components/SortTable.jsx";
import GameStatus from "../components/GameStatus.jsx";
import ScopeEmpty from "../components/ScopeEmpty.jsx";

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

/* Group standings for the selected season/group. Empty-state rules (UX-03 /
 * UX-19): a group with no results keeps its table but the points chart is
 * replaced by an explanation; a group with no teams shows a plain empty state
 * instead of an empty table. Unplayed fixtures are skipped and never shown as
 * results. */
export default function StandingsView({ ctx }) {
  const [sort, setSort] = useState(null);
  const [standings, teams, games] = [api("standings", ctx), api("teams", ctx), api("games", ctx)];

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Standings", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  const maxPf = Math.max(...teams.map((t) => t.pts_for), 1);
  const resolved = sortByKickoff(games.filter(hasResult), "desc");
  const latest = resolved.slice(0, 5);
  const rows = sort ? sortRows(standings, sort.key, sort.dir) : standings;

  const downloadCsv = () =>
    csvDownload(
      "standings.csv",
      ["Rank", "Team", "GP", "W", "L", "F", "+/-", "Points"],
      standings.map((s) => [s.pos ?? s.rank, s.team_name, s.gp, s.wins, s.losses, s.forfeits, s.diff, s.points])
    );

  const resultRow = (g) => (
    <a className="scope-result" href={`#/games/${g.event_id}`} key={g.event_id}>
      <div className="scope-result-top">
        <span className="scope-result-when">{fmtDate(g.game_date)}</span>
        <GameStatus game={g} />
      </div>
      <div className="scope-result-match">
        <span className="scope-result-team home">{g.home_name}</span>
        <strong className="scope-result-score od-nowrap">{scoreText(g)}</strong>
        <span className="scope-result-team away">{g.away_name}</span>
      </div>
    </a>
  );

  return (
    <>
      <div className="view-head">
        <div className="view-head-copy">
          <p className="eyebrow">{scopeLabel(ctx.season, ctx.group)}</p>
          <h2>Standings</h2>
        </div>
        <div className="toolbar">
          <div className="sub">
            {teams.length} teams · {resolved.length} played
          </div>
          <ShareButton kind="groups" id={`${ctx.season}/${ctx.group}`} />
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Group Table</h3>
          {standings.length ? (
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
          ) : (
            <ScopeEmpty
              title="No teams in this group yet"
              text="The table appears once this group's teams are entered."
            />
          )}
        </div>
        <div>
          <div className="card">
            <h3>Points for / against</h3>
            {resolved.length ? (
              teams.map((t) => (
                <div className="bar-row" key={t.team_id}>
                  <span className="bl"><a className="row-link" href={`#/teams/${t.team_id}`}>{t.team_name}</a></span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${Math.max((t.pts_for / maxPf) * 100, 2)}%` }} />
                  </div>
                  <span className="bv">{t.pts_for}</span>
                </div>
              ))
            ) : (
              <ScopeEmpty
                title="No games played yet"
                text="Points for / against appears after this group's first result."
                href={contextHash("games", ctx)}
                linkLabel="View fixtures ↗"
              />
            )}
          </div>
          <div className="card">
            <h3>Latest results</h3>
            {latest.length ? (
              latest.map(resultRow)
            ) : (
              <ScopeEmpty
                title="No completed games yet"
                text="Final scores are listed here once a result is recorded."
                href={contextHash("games", ctx)}
                linkLabel="View fixtures ↗"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
