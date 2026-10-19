import { useEffect } from "react";
import { api } from "../data.js";
import { contextQuery, csvDownload, fmtDate, go, resultOf, setTitle } from "../utils.js";
import { GroupedBars } from "../charts.jsx";
import { ShareButton, CsvButton } from "../components/Buttons.jsx";
import CompactDate from "../components/CompactDate.jsx";
import { usePalette } from "../theme.jsx";

export default function TeamDetail({ ctx, id, onAdoptContext }) {
  const palette = usePalette();
  let t = null;
  let err = null;
  try {
    t = api("teams/" + id, { season: ctx.season });
  } catch (e) {
    err = e;
  }

  useEffect(() => {
    if (t && (t.season_id !== ctx.season || t.group_id !== ctx.group)) {
      onAdoptContext(t.season_id, t.group_id);
    }
  }, [t && t.season_id, t && t.group_id, ctx.season, ctx.group]);

  useEffect(() => {
    if (t) setTitle(t.team_name, t.group_name, "Season " + ctx.season);
  }, [t && t.team_name, t && t.group_name, ctx.season]);

  if (err) return <div className="empty">{err.message}</div>;
  if (!t) return null;
  if (t.error) return <div className="empty">{t.error}</div>;

  const leaders = t.leaders.slice(0, 5);
  const trendGames = t.games
    .filter((x) => x.status === "completed")
    .sort((a, b) => a.game_date.localeCompare(b.game_date));
  const trend =
    trendGames.length > 0
      ? {
          rows: trendGames.map((x) => {
            const pf = x.home_team_id === id ? x.home_score : x.away_score;
            const pa = x.home_team_id === id ? x.away_score : x.home_score;
            const r = pf > pa ? "W" : pf < pa ? "L" : "T";
            return { label: `${fmtDate(x.game_date)} ${r}`, values: [pf, pa] };
          }),
          series: [
            { name: "Scored (PF)", color: palette[2] },
            { name: "Conceded (PA)", color: palette[3] },
          ],
        }
      : null;

  const rosterCsv = () =>
    csvDownload(
      "roster.csv",
      ["Jersey", "Player"],
      t.roster.map((p) => [p.jersey_no, p.player_name])
    );

  const resultsCsv = () =>
    csvDownload(
      "results.csv",
      ["Date", "Opponent", "Result", "Team", "Opp", "Venue"],
      t.games.map((g) => {
        const isHome = g.home_team_id === id;
        const r = resultOf(g, id);
        return [
          g.game_date,
          (isHome ? "vs " : "@ ") + (isHome ? g.away_name : g.home_name),
          r.text,
          isHome ? g.home_score : g.away_score,
          isHome ? g.away_score : g.home_score,
          g.venue,
        ];
      })
    );

  return (
    <>
      <a className="back" href="#/teams">← Teams</a>
      <div className="view-head">
        <h2>{t.team_name}</h2>
        <div className="toolbar">
          <div className="sub">{t.group_name || ""} · season {ctx.season}</div>
          <a className="csv-btn" href={`#/compare/t/${id}${contextQuery(ctx)}`}>⇄ Compare</a>
          <ShareButton kind="teams" id={id} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Season record</h3>
          <div className="scoreboard" style={{ gap: 26 }}>
            <div className="team">
              <div className="tname">W</div>
              <div className={`score ${t.wins > t.losses ? "winner" : ""}`}>{t.wins}</div>
            </div>
            <div className="vs">—</div>
            <div className="team">
              <div className="tname">L</div>
              <div className={`score ${t.losses > t.wins ? "loser" : ""}`}>{t.losses}</div>
            </div>
          </div>
          <div className="qstrip">
            <div className="q"><b>{t.gp}</b><span>GP</span></div>
            <div className="q"><b>{t.pts_for}</b><span>PF</span></div>
            <div className="q"><b>{t.pts_against}</b><span>PA</span></div>
            <div className="q">
              <b>{t.pts_for - t.pts_against > 0 ? "+" : ""}{t.pts_for - t.pts_against}</b>
              <span>±</span>
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Club info</h3>
          <dl className="kv">
            <dt>Manager</dt><dd>{t.manager || "—"}</dd>
            <dt>Captain</dt>
            <dd>
              {t.captain_player_id
                ? <a className="row-link" href={`#/players/${t.captain_player_id}`}>{t.captain_name}</a>
                : "—"}
            </dd>
            <dt>Home colour</dt><dd>{t.home_color || "—"}</dd>
            <dt>Away colour</dt><dd>{t.away_color || "—"}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <h3>Scoring by game <span className="cn">green = scored · red = conceded · W/L in label</span></h3>
        <div className="chart-box">
          {trend
            ? <GroupedBars rows={trend.rows} series={trend.series} showValues h={170} />
            : <div className="chart-empty">No completed games yet.</div>}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Roster <span className="cn">隊員名單</span></h3>
          <CsvButton id="roster-csv" onDownload={rosterCsv} />
          <table className="data">
            <thead>
              <tr><th className="num">#</th><th>Player</th></tr>
            </thead>
            <tbody>
              {t.roster.map((p) => (
                <tr key={p.player_id} tabIndex={0} data-href={`#/players/${p.player_id}`} onClick={(e) => {
                  if (e.target.closest("a")) return;
                  go(`#/players/${p.player_id}`);
                }}>
                  <td className="num mono">{p.jersey_no ?? "—"}</td>
                  <td><a className="row-link" href={`#/players/${p.player_id}`}>{p.player_name}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Season leaders</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Player</th><th className="num">GP</th><th className="num">PTS</th><th className="num">REB</th>
                <th className="num">AST</th><th className="num">ST</th><th className="num">EFF</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((p) => (
                <tr key={p.player_id} tabIndex={0} data-href={`#/players/${p.player_id}`} onClick={(e) => {
                  if (e.target.closest("a")) return;
                  go(`#/players/${p.player_id}`);
                }}>
                  <td><a className="row-link" href={`#/players/${p.player_id}`}>{p.player_name}</a></td>
                  <td className="num">{p.gp}</td><td className="num">{p.pts}</td><td className="num">{p.reb}</td>
                  <td className="num">{p.ast}</td><td className="num">{p.stl}</td><td className="num">{p.eff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Results <span className="cn">賽程</span></h3>
        <CsvButton id="results-csv" onDownload={resultsCsv} />
        <table className="data pin1">
          <thead>
            <tr>
              <th>Date</th><th>Opponent</th><th>Result</th>
              <th className="num">Team</th><th className="num">Opp</th><th>Venue</th>
            </tr>
          </thead>
          <tbody>
            {t.games.length ? t.games.map((g) => {
              const isHome = g.home_team_id === id;
              const opp = isHome ? g.away_name : g.home_name;
              const oppId = isHome ? g.away_team_id : g.home_team_id;
              const r = resultOf(g, id);
              return (
                <tr key={g.event_id} tabIndex={0} data-href={`#/games/${g.event_id}`} onClick={(e) => {
                  if (e.target.closest("a")) return;
                  go(`#/games/${g.event_id}`);
                }}>
                  <td className="game-date-cell"><CompactDate date={g.game_date} /></td>
                  <td>{isHome ? "vs" : "@"} <a className="row-link" href={`#/teams/${oppId}`}>{opp}</a></td>
                  <td className={r.cls}>{r.text}</td>
                  <td className="num mono">{isHome ? g.home_score : g.away_score}</td>
                  <td className="num mono">{isHome ? g.away_score : g.home_score}</td>
                  <td>{g.venue || "—"}</td>
                </tr>
              );
            }) : <tr><td colSpan="6" className="empty">No games</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
