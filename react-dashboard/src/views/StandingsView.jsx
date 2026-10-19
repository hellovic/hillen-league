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
import MobileColumnsToggle from "../components/MobileColumnsToggle.jsx";
import StatGuide from "../components/StatGuide.jsx";
import { GUIDE_GROUPS } from "../glossary.js";

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
 * results.
 *
 * UX-06: the "Points for / against" card used to show one orange bar per team
 * and one number — it was impossible to tell whether the bar was scored or
 * conceded points. The chart now renders a paired PF (solid) bar and PA
 * (striped) bar with both totals printed, a named legend, and a screen-reader
 * table. A team that has not played says so instead of drawing a zero bar. */
export default function StandingsView({ ctx }) {
  const [sort, setSort] = useState(null);
  /* UX-05/UX-21: phones get # / Team / W / L / Pts by default (the eight-column
   * table does not fit 320 px); the disclosure reveals GP, F and ±. */
  const [allCols, setAllCols] = useState(false);
  const [standings, teams, games] = [api("standings", ctx), api("teams", ctx), api("games", ctx)];

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Standings", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  const resolved = sortByKickoff(games.filter(hasResult), "desc");
  const latest = resolved.slice(0, 5);
  const rows = sort ? sortRows(standings, sort.key, sort.dir) : standings;

  /* PF/PA chart (UX-06): both series share one scale so a team's scored and
   * conceded totals are directly comparable. Bar length is relative to the
   * group's highest single total, and every bar prints its number. */
  const maxPts = Math.max(
    1,
    ...teams.map((t) => Math.max(t.pts_for || 0, t.pts_against || 0))
  );
  const barPct = (v) => (v > 0 ? Math.max((v / maxPts) * 100, 2) : 0);
  const hasScores = teams.some((t) => (t.pts_for || 0) > 0 || (t.pts_against || 0) > 0);
  const playedTeams = teams.filter((t) => (t.gp || 0) > 0);

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
          <MobileColumnsToggle
            controls="st-table"
            expanded={allCols}
            onToggle={() => setAllCols((v) => !v)}
            label="Full table"
          />
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
                compact="standings"
                compactExpanded={allCols}
                sort={sort}
                onSort={setSort}
                rowKey={(s) => s.team_id}
                rowHref={(s) => `#/teams/${s.team_id}`}
                renderRow={(s) => [
                  <td className="num" key="pos">{s.pos ?? s.rank}</td>,
                  <td key="team">
                    <a className="row-link nm" title={s.team_name} href={`#/teams/${s.team_id}`}>
                      {s.team_name}
                    </a>
                  </td>,
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
          <div className="card pfpa-card">
            <div className="card-head">
              <h3>Points scored vs conceded</h3>
              <StatGuide items={GUIDE_GROUPS.standings} />
            </div>
            {hasScores ? (
              <>
                <p className="pfpa-legend">
                  <span className="pfpa-legend-item">
                    <span className="pfpa-swatch pf" aria-hidden="true" />
                    <b>PF</b> points scored
                  </span>
                  <span className="pfpa-legend-item">
                    <span className="pfpa-swatch pa" aria-hidden="true" />
                    <b>PA</b> points conceded
                  </span>
                </p>
                <ul className="pfpa-list">
                  {teams.map((t) => {
                    const played = (t.gp || 0) > 0;
                    return (
                      <li className={`pfpa-row${played ? "" : " pfpa-row-empty"}`} key={t.team_id}>
                        <span className="pfpa-team">
                          <a className="row-link" title={t.team_name} href={`#/teams/${t.team_id}`}>
                            {t.team_name}
                          </a>
                        </span>
                        {played ? (
                          <span className="pfpa-bars">
                            <span className="pfpa-line">
                              <span className="pfpa-tag">PF</span>
                              <span className="pfpa-track">
                                <span className="pfpa-fill pf" style={{ width: `${barPct(t.pts_for)}%` }} />
                              </span>
                              <span className="pfpa-val">{t.pts_for ?? 0}</span>
                            </span>
                            <span className="pfpa-line">
                              <span className="pfpa-tag">PA</span>
                              <span className="pfpa-track">
                                <span className="pfpa-fill pa" style={{ width: `${barPct(t.pts_against)}%` }} />
                              </span>
                              <span className="pfpa-val">{t.pts_against ?? 0}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="pfpa-none">No games played yet</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="pfpa-note">
                  Scored and conceded totals share one scale (group maximum {maxPts}); completed results only.
                  {playedTeams.length < teams.length
                    ? " Teams that have not played yet are listed without bars."
                    : ""}
                </p>
                <div className="sr-only">
                  <table>
                  <caption>Points scored (PF) and conceded (PA) by team in this group</caption>
                  <thead>
                    <tr>
                      <th scope="col">Team</th>
                      <th scope="col">Games played</th>
                      <th scope="col">PF, points scored</th>
                      <th scope="col">PA, points conceded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t) => (
                      <tr key={t.team_id}>
                        <th scope="row">{t.team_name}</th>
                        <td>{(t.gp || 0) > 0 ? t.gp : 0}</td>
                        <td>{(t.gp || 0) > 0 ? t.pts_for ?? 0 : "—"}</td>
                        <td>{(t.gp || 0) > 0 ? t.pts_against ?? 0 : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </>
            ) : resolved.length ? (
              <ScopeEmpty
                title="No scoring totals yet"
                text="Results are recorded for this group, but no points have been counted yet (forfeits or no recorded score)."
                href={contextHash("games", ctx)}
                linkLabel="View fixtures ↗"
              />
            ) : (
              <ScopeEmpty
                title="No games played yet"
                text="Points scored and conceded appear after this group's first final score."
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
