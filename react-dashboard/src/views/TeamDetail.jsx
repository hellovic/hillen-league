import { useEffect, useState } from "react";
import { api } from "../data.js";
import { contextQuery, csvDownload, fmtDate, n1, resultOf, setTitle, signed, sortRows } from "../utils.js";
import { GroupedBars } from "../charts.jsx";
import { ShareButton, CsvButton } from "../components/Buttons.jsx";
import CompactDate from "../components/CompactDate.jsx";
import MobileColumnsToggle from "../components/MobileColumnsToggle.jsx";
import SortTable from "../components/SortTable.jsx";
import StatGuide from "../components/StatGuide.jsx";
import { GUIDE_GROUPS } from "../glossary.js";
import { usePalette } from "../theme.jsx";

const ROSTER_COLS = [
  { key: "jersey_no", label: "#", num: true },
  { key: "player_name", label: "Player" },
  { key: "gp", label: "GP", num: true },
  { key: "minutes", label: "MIN", num: true },
  { key: "pts", label: "PTS", num: true },
  { key: "reb", label: "REB", num: true },
  { key: "ast", label: "AST", num: true },
  { key: "stl", label: "STL", num: true },
  { key: "blk", label: "BLK", num: true },
  { key: "tov", label: "TO", num: true },
  { key: "pf", label: "PF", num: true },
  { key: "eff", label: "EFF", num: true },
  { key: "plus_minus", label: "+/-", num: true },
];

const RESULTS_COLS = [
  { key: "game_date", label: "Date", sortable: false },
  { key: "opponent", label: "Opponent", sortable: false },
  { key: "result", label: "Result", sortable: false },
  { key: "team_score", label: "Team", num: true, sortable: false },
  { key: "opp_score", label: "Opp", num: true, sortable: false },
  { key: "venue", label: "Venue", sortable: false },
];

const LEADER_COLS = [
  { key: "player_name", label: "Player", sortable: false },
  { key: "gp", label: "GP", num: true, sortable: false },
  { key: "pts", label: "PTS", num: true, sortable: false },
  { key: "reb", label: "REB", num: true, sortable: false },
  { key: "ast", label: "AST", num: true, sortable: false },
  { key: "stl", label: "STL", num: true, sortable: false },
  { key: "eff", label: "EFF", num: true, sortable: false },
];

export default function TeamDetail({ ctx, id, onAdoptContext }) {
  const palette = usePalette();
  const [allCols, setAllCols] = useState(false);
  const [allResultCols, setAllResultCols] = useState(false);
  const [allLeaderCols, setAllLeaderCols] = useState(false);
  const [rosterSort, setRosterSort] = useState(null);
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
  /* The roster payload only carries jersey + name; join the group player rows so
   * the phone roster can show per-player stats. Players who appear in the roster
   * but not in this group's stats (e.g. moved age group) keep em-dashes. */
  /* Key on the rendered team too: a player who moves club mid-season has one
   * stats row per team in the same season+group, so indexing by player_id
   * alone let the other team's row overwrite this roster's stats. */
  const statsById = new Map(
    api("players", ctx)
      .filter((p) => p.team_id === id)
      .map((p) => [p.player_id, p])
  );
  const rosterRows = t.roster.map((p) => {
    const s = statsById.get(p.player_id) || {};
    return {
      jersey_no: p.jersey_no,
      player_id: p.player_id,
      player_name: p.player_name,
      gp: s.gp,
      minutes: s.minutes,
      pts: s.pts,
      reb: s.reb,
      ast: s.ast,
      stl: s.stl,
      blk: s.blk,
      tov: s.tov,
      pf: s.pf,
      eff: s.eff,
      plus_minus: s.plus_minus,
    };
  });
  const rosterSorted = rosterSort
    ? sortRows(rosterRows, rosterSort.key, rosterSort.dir)
    : rosterRows;

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
        <div className="toolbar detail-actions">
          <div className="sub">{t.group_name || ""} · season {ctx.season}</div>
          <a className="csv-btn" href={`#/compare/t/${id}${contextQuery(ctx)}`}>⇄ Compare</a>
          <ShareButton kind="teams" id={id} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Season record</h3>
            <StatGuide items={GUIDE_GROUPS.standings} />
          </div>
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
          <MobileColumnsToggle
            controls="t-roster"
            expanded={allCols}
            onToggle={() => setAllCols((v) => !v)}
            label="Advanced stats"
          />
          <SortTable
            columns={ROSTER_COLS}
            rows={rosterSorted}
            tableId="t-roster"
            pin={1}
            compact="roster"
            compactExpanded={allCols}
            sort={rosterSort}
            onSort={(next) => setRosterSort(next)}
            rowKey={(p) => p.player_id}
            rowHref={(p) => `#/players/${p.player_id}`}
            renderRow={(p) => {
              const pm = p.plus_minus === undefined || p.plus_minus === null ? null : p.plus_minus;
              return [
                <td className="num mono" key="jersey">{p.jersey_no ?? "—"}</td>,
                <td key="player">
                  <a className="row-link nm" title={p.player_name} href={`#/players/${p.player_id}`}>{p.player_name}</a>
                </td>,
                <td className="num" key="gp">{p.gp ?? "—"}</td>,
                <td className="num mono" key="min">{n1(p.minutes)}</td>,
                <td className="num" key="pts">{p.pts ?? "—"}</td>,
                <td className="num" key="reb">{p.reb ?? "—"}</td>,
                <td className="num" key="ast">{p.ast ?? "—"}</td>,
                <td className="num" key="stl">{p.stl ?? "—"}</td>,
                <td className="num" key="blk">{p.blk ?? "—"}</td>,
                <td className="num" key="tov">{p.tov ?? "—"}</td>,
                <td className="num" key="pf">{p.pf ?? "—"}</td>,
                <td className="num" key="eff">{p.eff ?? "—"}</td>,
                <td className={`num ${pm === null ? "" : pm >= 0 ? "winner" : "loser"}`} key="pm">
                  {signed(pm)}
                </td>,
              ];
            }}
            emptyText="No roster"
          />
        </div>
        <div className="card">
          <h3>Season leaders</h3>
          <MobileColumnsToggle
            controls="t-leaders"
            expanded={allLeaderCols}
            onToggle={() => setAllLeaderCols((v) => !v)}
            label="More stats"
          />
          <SortTable
            columns={LEADER_COLS}
            rows={leaders}
            tableId="t-leaders"
            pin={1}
            sortable={false}
            compact="leaders"
            compactExpanded={allLeaderCols}
            rowKey={(p) => p.player_id}
            rowHref={(p) => `#/players/${p.player_id}`}
            renderRow={(p) => [
              <td key="player">
                <a className="row-link nm" title={p.player_name} href={`#/players/${p.player_id}`}>{p.player_name}</a>
              </td>,
              <td className="num" key="gp">{p.gp}</td>,
              <td className="num" key="pts">{p.pts}</td>,
              <td className="num" key="reb">{p.reb}</td>,
              <td className="num" key="ast">{p.ast}</td>,
              <td className="num" key="stl">{p.stl}</td>,
              <td className="num" key="eff">{p.eff}</td>,
            ]}
            emptyText="No leaders"
          />
        </div>
      </div>

      <div className="card">
        <h3>Results <span className="cn">賽程</span></h3>
        <CsvButton id="results-csv" onDownload={resultsCsv} />
        <MobileColumnsToggle
          controls="t-team-results"
          expanded={allResultCols}
          onToggle={() => setAllResultCols((v) => !v)}
          label="Scores & venue"
        />
        <SortTable
          columns={RESULTS_COLS}
          rows={t.games}
          tableId="t-team-results"
          pin={1}
          sortable={false}
          compact="results"
          compactExpanded={allResultCols}
          rowKey={(g) => g.event_id}
          rowHref={(g) => `#/games/${g.event_id}`}
          renderRow={(g) => {
            const isHome = g.home_team_id === id;
            const opp = isHome ? g.away_name : g.home_name;
            const oppId = isHome ? g.away_team_id : g.home_team_id;
            const r = resultOf(g, id);
            return [
              <td className="game-date-cell" key="date"><CompactDate date={g.game_date} /></td>,
              <td key="opp">
                {isHome ? "vs" : "@"} <a className="row-link" title={opp} href={`#/teams/${oppId}`}>{opp}</a>
              </td>,
              <td className={r.cls} key="result">{r.text}</td>,
              <td className="num mono" key="pf">{isHome ? g.home_score : g.away_score}</td>,
              <td className="num mono" key="pa">{isHome ? g.away_score : g.home_score}</td>,
              <td key="venue">{g.venue || "—"}</td>,
            ];
          }}
          emptyText="No games"
        />
      </div>
    </>
  );
}
