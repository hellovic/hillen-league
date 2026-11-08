import { useLocale } from "../locale.jsx";
import { useEffect, useState } from "react";
import { api, groupName } from "../data.js";
import { contextHash, csvDownload, gameStatus, hasResult, kickoffKey, scoreText, setTitle, sortByKickoff, sortRows } from "../utils.js";
import { CsvButton } from "../components/Buttons.jsx";
import CompactDate from "../components/CompactDate.jsx";
import SortTable from "../components/SortTable.jsx";
import GameStatus from "../components/GameStatus.jsx";
import ScopeEmpty from "../components/ScopeEmpty.jsx";

const KEYS = [
  { key: "game_date", label: "Date" },
  { key: "home_name", label: "Home" },
  { key: "home_score", label: "Score", num: true },
  { key: "away_name", label: "Away" },
  { key: "venue", label: "Venue" },
  { key: "status", label: "Status" },
];

/* Every fixture of the selected season/group. Sorting uses the raw `status` and
 * ISO date fields from the payload (never a rendered label); the Status column
 * is the shared GameStatus badge, so a skipped fixture (past, no score) is never
 * confused with "Final" or "Scheduled". Missing scores stay em dashes. */
export default function GamesView({ ctx }) {
  const { t: tr, group, scope } = useLocale();
  const [sort, setSort] = useState(null);
  const games = api("games", ctx);
  const resolved = games.filter(hasResult);
  const skipped = games.filter((g) => gameStatus(g).code === "skipped");
  /* Newest fixture first: the list is a schedule, so the most recent game is
   * what a visitor looks for. Column clicks still override this default. */
  const newestFirst = sortByKickoff(games, "desc");

  useEffect(() => {
    setTitle(group(groupName(ctx.season, ctx.group)), tr("Games"), tr("Season {season}", ctx));
  }, [ctx.season, ctx.group, tr, group]);

  const rows = sort ? sortRows(games, sort.key, sort.dir) : newestFirst;

  const downloadCsv = () =>
    csvDownload(
      "games.csv",
      ["Date", "Home", "Score", "Away", "Venue", "Status"],
      rows.map((g) => [
        g.game_date, g.home_name,
        hasResult(g) ? `${g.home_score}-${g.away_score}` : "",
        g.away_name, g.venue, g.status,
      ])
    );

  return (
    <>
      <div className="view-head">
        <div className="view-head-copy">
          <p className="eyebrow">{scope(ctx.season, ctx.group)}</p>
          <h2>{tr("Games")}</h2>
        </div>
        <div className="toolbar">
          <div className="sub">
            {tr("{fixtures} fixtures · {games} played", { fixtures: games.length, games: resolved.length })}
            {skipped.length ? ` · ${tr("{count} skipped", { count: skipped.length })}` : ""}
          </div>
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>
      <div className="card">
        {games.length ? (
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
                <td className="num mono" key="score">{scoreText(g)}</td>,
                <td key="away"><a className="row-link" href={`#/teams/${g.away_team_id}`}>{g.away_name}</a></td>,
                <td key="venue">{g.venue || "—"}</td>,
                <td key="status"><GameStatus game={g} /></td>,
              ]}
            />
          </div>
        ) : (
          <ScopeEmpty
            title={tr("No fixtures yet")}
            text="This group has no scheduled games in the bundle."
            href={contextHash("standings", ctx)}
            linkLabel="View standings ↗"
          />
        )}
      </div>
    </>
  );
}
