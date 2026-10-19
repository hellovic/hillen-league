import { useEffect, useState } from "react";
import { api, groupName } from "../data.js";
import { contextQuery, csvDownload, efgPct, fmtDate, pctStr, resultOf, setTitle, tsPct } from "../utils.js";
import { GroupedBars, RadarChart } from "../charts.jsx";
import { ShareButton, CsvButton } from "../components/Buttons.jsx";
import CompactDate from "../components/CompactDate.jsx";
import MobileColumnsToggle from "../components/MobileColumnsToggle.jsx";
import SortTable from "../components/SortTable.jsx";
import { usePalette } from "../theme.jsx";

const GAMELOG_COLS = [
  { key: "game_date", label: "Date", sortable: false },
  { key: "opponent", label: "Opponent", sortable: false },
  { key: "result", label: "Result", sortable: false },
  { key: "minutes", label: "MIN", num: true, sortable: false },
  { key: "pts", label: "PTS", num: true, sortable: false },
  { key: "fg2", label: "2PT", num: true, sortable: false },
  { key: "fg3", label: "3PT", num: true, sortable: false },
  { key: "ft", label: "FT", num: true, sortable: false },
  { key: "tot_reb", label: "REB", num: true, sortable: false },
  { key: "ast", label: "AST", num: true, sortable: false },
  { key: "stl", label: "ST", num: true, sortable: false },
  { key: "blk", label: "BS", num: true, sortable: false },
  { key: "tov", label: "TO", num: true, sortable: false },
  { key: "pf", label: "PF", num: true, sortable: false },
  { key: "eff", label: "EFF", num: true, sortable: false },
  { key: "plus_minus", label: "+/−", num: true, sortable: false },
];

export default function PlayerDetail({ ctx, id }) {
  const palette = usePalette();
  const [allCols, setAllCols] = useState(false);
  let p = null;
  let err = null;
  try {
    p = api("players/" + id, ctx);
  } catch (e) {
    err = e;
  }

  useEffect(() => {
    if (p && !p.error) {
      setTitle(p.player_name, p.team_name, groupName(ctx.season, ctx.group), "Season " + ctx.season);
    } else {
      setTitle("Not found");
    }
  }, [p && p.player_name, ctx.season, ctx.group]);

  if (err) {
    return (
      <div className="empty">
        No stats — this player doesn't appear in {groupName(ctx.season, ctx.group)} · Season {ctx.season}. Try another group or season.
      </div>
    );
  }
  if (!p) return null;
  if (p.error) return <div className="empty">{p.error}</div>;

  const groupList = api("players", ctx);
  const gN = Math.max(groupList.length, 1);
  const avg = (k) => groupList.reduce((s, x) => s + (x[k] || 0) / Math.max(x.gp, 1), 0) / gN;
  const g = (n) => Math.max(n, 1);
  const pv = [p.pts / g(p.gp), p.reb / g(p.gp), p.ast / g(p.gp), p.stl / g(p.gp), p.blk / g(p.gp), p.eff / g(p.gp)];
  const av = [avg("pts"), avg("reb"), avg("ast"), avg("stl"), avg("blk"), avg("eff")];
  const axes = ["PTS", "REB", "AST", "STL", "BLK", "EFF"].map((label, i) => ({
    label,
    max: Math.max(pv[i], av[i], 0.1) * 1.25,
  }));
  const ptsBars = p.games.length ? (
    <GroupedBars
      rows={p.games.map((x) => ({ label: fmtDate(x.game_date), values: [x.pts] }))}
      series={[{ name: "PTS", color: palette[0] }]}
    />
  ) : (
    <div className="chart-empty">No games played.</div>
  );

  const downloadCsv = () =>
    csvDownload(
      "player_games.csv",
      ["Date", "Opponent", "Result", "MIN", "PTS", "2PT", "3PT", "FT", "REB", "AST", "ST", "BS", "TO", "PF", "EFF", "+/-"],
      p.games.map((x) => {
        const isHome = x.home_team_id === x.team_id;
        const r = resultOf(x, x.team_id);
        return [
          x.game_date, x.opponent, r.text, x.minutes, x.pts,
          `${x.fgm - x.fg3m}-${x.fga - x.fg3a}`, `${x.fg3m}-${x.fg3a}`, `${x.ftm}-${x.fta}`,
          x.tot_reb, x.ast, x.stl, x.blk, x.tov, x.pf, x.eff, x.plus_minus,
        ];
      })
    );

  return (
    <>
      <a className="back" href="#/players">← Players</a>
      <div className="view-head">
        <h2>{p.player_name}</h2>
        <div className="toolbar detail-actions">
          <div className="sub">
            <a className="row-link" href={`#/teams/${p.team_id}`}>{p.team_name}</a> · season {ctx.season}
          </div>
          <a className="csv-btn" href={`#/compare/p/${id}${contextQuery(ctx)}`}>⇄ Compare</a>
          <ShareButton kind="players" id={id} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Season totals</h3>
          <div className="qstrip">
            <div className="q"><b>{p.gp}</b><span>GP</span></div>
            <div className="q"><b>{p.pts}</b><span>PTS</span></div>
            <div className="q"><b>{p.reb}</b><span>REB</span></div>
            <div className="q"><b>{p.ast}</b><span>AST</span></div>
            <div className="q"><b>{p.stl}</b><span>ST</span></div>
            <div className="q"><b>{p.blk}</b><span>BS</span></div>
            <div className="q"><b>{p.eff}</b><span>EFF</span></div>
          </div>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Minutes</dt>
            <dd className="mono">{p.minutes.toFixed(1)} ({p.gp ? (p.minutes / p.gp).toFixed(1) : 0}/g)</dd>
            <dt>Shooting</dt>
            <dd className="mono sstats">
              <span>{p.fgm}/{p.fga} FG</span>
              <span>{p.fg2m}/{p.fg2a} 2P</span>
              <span>{p.fg3m}/{p.fg3a} 3P</span>
              <span>{p.ftm}/{p.fta} FT</span>
            </dd>
            <dt>Efficiency</dt>
            <dd className="mono sstats">
              <span>eFG% {pctStr(efgPct(p.fgm, p.fga, p.fg3m))}</span>
              <span>FT% {pctStr(p.fta ? (p.ftm / p.fta) * 100 : null)}</span>
              <span>TS% {pctStr(tsPct(p.pts, p.fga, p.fta))}</span>
            </dd>
            <dt>Off / Def reb</dt><dd className="mono">{p.off_reb} / {p.def_reb}</dd>
            <dt>Turnovers / fouls</dt><dd className="mono">{p.tov} / {p.pf}</dd>
            <dt>Fast-break / blk-against</dt><dd className="mono">{p.fb} / {p.ba}</dd>
            <dt>+/-</dt><dd className="mono">{p.plus_minus > 0 ? "+" : ""}{p.plus_minus}</dd>
          </dl>
        </div>
        <div className="player-side">
        <div className="card">
          <h3>Per game</h3>
          <div className="qstrip">
            <div className="q"><b>{(p.pts / Math.max(p.gp, 1)).toFixed(1)}</b><span>PPG</span></div>
            <div className="q"><b>{(p.reb / Math.max(p.gp, 1)).toFixed(1)}</b><span>RPG</span></div>
            <div className="q"><b>{(p.ast / Math.max(p.gp, 1)).toFixed(1)}</b><span>APG</span></div>
            <div className="q"><b>{(p.stl / Math.max(p.gp, 1)).toFixed(1)}</b><span>SPG</span></div>
            <div className="q"><b>{(p.blk / Math.max(p.gp, 1)).toFixed(1)}</b><span>BPG</span></div>
            <div className="q"><b>{(p.eff / Math.max(p.gp, 1)).toFixed(1)}</b><span>EFF</span></div>
          </div>
        </div>
        <div className="card">
          <h3>vs group average <span className="cn">per game</span></h3>
          <RadarChart
            axes={axes}
            series={[
              { name: p.player_name, color: palette[0], values: pv },
              { name: "Group avg", color: palette[4], values: av },
            ]}
          />
        </div>
        </div>
      </div>

      <div className="card">
        <h3>Points per game</h3>
        <div className="chart-fit">{ptsBars}</div>
      </div>

      <div className="card">
        <h3>Game log <span className="cn">比賽表現</span></h3>
        <CsvButton id="gamelog-csv" onDownload={downloadCsv} />
        <MobileColumnsToggle
          controls="t-gamelog"
          expanded={allCols}
          onToggle={() => setAllCols((v) => !v)}
          label="Full game log"
        />
        <SortTable
          columns={GAMELOG_COLS}
          rows={p.games}
          tableId="t-gamelog"
          pin={1}
          sortable={false}
          compact="gamelog"
          compactExpanded={allCols}
          rowKey={(x) => x.event_id}
          rowHref={(x) => `#/games/${x.event_id}`}
          renderRow={(x) => {
            const isHome = x.home_team_id === x.team_id;
            const r = resultOf(x, x.team_id);
            return [
              <td className="game-date-cell" key="date"><CompactDate date={x.game_date} /></td>,
              <td key="opp">
                {isHome ? "vs" : "@"}{" "}
                <a className="row-link" title={x.opponent} href={`#/teams/${isHome ? x.away_team_id : x.home_team_id}`}>{x.opponent}</a>
              </td>,
              <td className={r.cls} key="result">{r.text}</td>,
              <td className="num mono" key="min">{x.minutes}</td>,
              <td className="num mono" key="pts">{x.pts}</td>,
              <td className="num mono" key="2pt">{x.fgm - x.fg3m}-{x.fga - x.fg3a}</td>,
              <td className="num mono" key="3pt">{x.fg3m}-{x.fg3a}</td>,
              <td className="num mono" key="ft">{x.ftm}-{x.fta}</td>,
              <td className="num" key="reb">{x.tot_reb}</td>,
              <td className="num" key="ast">{x.ast}</td>,
              <td className="num" key="stl">{x.stl}</td>,
              <td className="num" key="blk">{x.blk}</td>,
              <td className="num" key="tov">{x.tov}</td>,
              <td className="num" key="pf">{x.pf}</td>,
              <td className="num" key="eff">{x.eff}</td>,
              <td className={`num ${x.plus_minus >= 0 ? "winner" : "loser"}`} key="pm">
                {x.plus_minus > 0 ? "+" : ""}{x.plus_minus}
              </td>,
            ];
          }}
          emptyText="No games"
        />
      </div>
    </>
  );
}
