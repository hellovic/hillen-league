import { useLocale } from "../locale.jsx";
import { useEffect } from "react";
import { api, groupName } from "../data.js";
import { contextQuery, csvDownload, efgPct, n1, pctStr, resultOf, setTitle, signed, tsPct } from "../utils.js";
import { RadarChart } from "../charts.jsx";
import { ShareButton, CsvButton } from "../components/Buttons.jsx";
import CompactDate from "../components/CompactDate.jsx";
import StatGuide from "../components/StatGuide.jsx";
import { GUIDE_GROUPS } from "../glossary.js";
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
  { key: "stl", label: "STL", num: true, sortable: false },
  { key: "blk", label: "BLK", num: true, sortable: false },
  { key: "tov", label: "TO", num: true, sortable: false },
  { key: "pf", label: "PF", num: true, sortable: false },
  { key: "eff", label: "EFF", num: true, sortable: false },
  { key: "plus_minus", label: "+/−", num: true, sortable: false },
];

const SEASON_HIGH_STATS = [
  { key: "pts", label: "Points" },
  { key: "tot_reb", label: "Rebounds" },
  { key: "ast", label: "Assists" },
];

const SHOT_TYPES = [
  ["2-pointers", "fg2m", "fg2a"],
  ["3-pointers", "fg3m", "fg3a"],
  ["Free throws", "ftm", "fta"],
];

export default function PlayerDetail({ ctx, id }) {
  const { t: tr, group } = useLocale();
  const palette = usePalette();
  let p = null;
  let err = null;
  try {
    p = api("players/" + id, ctx);
  } catch (e) {
    err = e;
  }

  useEffect(() => {
    if (p && !p.error) {
      setTitle(p.player_name, p.team_name, group(groupName(ctx.season, ctx.group)), tr("Season {season}", ctx));
    } else {
      setTitle(tr("Not found"));
    }
  }, [p && p.player_name, ctx.season, ctx.group, tr, group]);

  if (err) {
    return (
      <div className="empty">
        {tr("No stats — this player doesn’t appear in {scope}. Try another group or season.", { scope: `${group(groupName(ctx.season, ctx.group))} · ${tr("Season {season}", ctx)}` })}
      </div>
    );
  }
  if (!p) return null;
  if (p.error) return <div className="empty">{tr(p.error)}</div>;

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
  const radarSeries = [
    { name: p.player_name, color: palette[0], values: pv },
    { name: tr("Group average"), color: palette[4], values: av },
  ];
  const radarLabel = radarSeries.map(({ name, values }) =>
    `${name}: ${axes.map(({ label }, i) => `${label} ${n1(values[i])}`).join(", ")}`
  ).join(". ");
  const seasonHighs = SEASON_HIGH_STATS.map(({ key, label }) => {
    const game = p.games.reduce((best, entry) => {
      if (!Number.isFinite(entry[key])) return best;
      if (!best || entry[key] > best[key]) return entry;
      if (entry[key] !== best[key]) return best;
      const dateOrder = (entry.game_date || "").localeCompare(best.game_date || "");
      return dateOrder > 0 || (dateOrder === 0 && entry.event_id > best.event_id) ? entry : best;
    }, null);
    return { key, label, game };
  });
  const highCell = (game, stat) => {
    const best = seasonHighs.find(({ key }) => key === stat)?.game;
    const isHigh = best && game[stat] > 0 && game[stat] === best[stat];
    return (
      <td className={`num${stat === "pts" ? " mono" : ""}${isHigh ? " season-high-cell" : ""}`} key={stat}>
        {game[stat]}
        {isHigh && <span className="sr-only"> {tr("Season high")}</span>}
      </td>
    );
  };

  const downloadCsv = () =>
    csvDownload(
      "player_games.csv",
      ["Date", "Opponent", "Result", "MIN", "PTS", "2PT", "3PT", "FT", "REB", "AST", "STL", "BLK", "TO", "PF", "EFF", "+/-"],
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
      <a className="back player-profile-back" href="#/players">{tr("← Players")}</a>
      <div className="view-head player-profile-heading">
        <h2>{p.player_name}</h2>
        <div className="toolbar player-detail-toolbar">
          <div className="sub">
            <a className="row-link" href={`#/teams/${p.team_id}`} title={p.team_name}>{p.team_name}</a>
            <span>· {tr("season {season}", ctx)}</span>
          </div>
          <div className="player-detail-actions">
            <a className="csv-btn" href={`#/compare/p/${id}${contextQuery(ctx)}`}>{tr("⇄ Compare")}</a>
            <a className="csv-btn" href={`#/player-story/${id}`}>{tr("Player Story")}</a>
            <ShareButton kind="players" id={id} />
          </div>
        </div>
      </div>

      {seasonHighs.some(({ game }) => game) && (
        <div className="card player-season-highs">
          <h3>{tr("Season highs")}</h3>
          <div className="player-season-high-grid">
            {seasonHighs.filter(({ game }) => game).map(({ key, label, game }) => (
              <a className="row-link" key={key} href={`#/games/${game.event_id}`}>
                <b className="mono">{game[key]}</b>
                <span>{tr(label)}</span>
                {game.game_date && <CompactDate date={game.game_date} />}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="grid-2 player-stats-grid">
        <div className="card player-season-totals">
          <div className="card-head">
            <h3>{tr("Season totals")}</h3>
            <StatGuide items={GUIDE_GROUPS.player} />
          </div>
          <div className="qstrip season-totals-summary">
            <div className="q"><b>{p.gp}</b><span>GP</span></div>
            <div className="q"><b>{p.pts}</b><span>PTS</span></div>
            <div className="q"><b>{p.reb}</b><span>REB</span></div>
            <div className="q"><b>{p.ast}</b><span>AST</span></div>
          </div>
          <details className="season-totals-details" key={`${id}/${ctx.season}/${ctx.group}`}>
            <summary>{tr("Full stats")}</summary>
            <div className="qstrip season-totals-secondary">
              <div className="q"><b>{p.stl}</b><span>STL</span></div>
              <div className="q"><b>{p.blk}</b><span>BLK</span></div>
              <div className="q"><b>{p.eff}</b><span>EFF</span></div>
            </div>
            <section className="shooting-breakdown" aria-labelledby="shooting-breakdown-heading">
              <h4 id="shooting-breakdown-heading">{tr("Shooting breakdown")}</h4>
              <ul>
                {SHOT_TYPES.map(([label, madeKey, attemptsKey]) => {
                  const made = p[madeKey];
                  const attempts = p[attemptsKey];
                  const hasCounts = Number.isFinite(made) && Number.isFinite(attempts);
                  const pct = hasCounts && attempts > 0 ? (made / attempts) * 100 : null;
                  return (
                    <li key={label}>
                      <div className="shooting-breakdown-label">
                        <span>{tr(label)}</span>
                        <span className="mono">{hasCounts ? `${made}/${attempts}` : "—"}</span>
                        <span className="mono muted">{pctStr(pct)}</span>
                      </div>
                      <div className="shooting-breakdown-track" aria-hidden="true">
                        <span style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <dl className="kv">
              <dt>{tr("Minutes")}</dt>
              <dd className="mono">{n1(p.minutes)} ({n1(p.gp ? p.minutes / p.gp : null)}/g)</dd>
              <dt>{tr("Field goals")}</dt>
              <dd className="mono">{p.fgm}/{p.fga}</dd>
              <dt>{tr("Efficiency")}</dt>
              <dd className="mono sstats">
                <span>eFG% {pctStr(efgPct(p.fgm, p.fga, p.fg3m))}</span>
                <span>TS% {pctStr(tsPct(p.pts, p.fga, p.fta))}</span>
              </dd>
              <dt>{tr("Off / Def reb")}</dt><dd className="mono">{p.off_reb} / {p.def_reb}</dd>
              <dt>{tr("Turnovers / fouls")}</dt><dd className="mono">{p.tov} / {p.pf}</dd>
              <dt>{tr("Fast-break / blk-against")}</dt><dd className="mono">{p.fb} / {p.ba}</dd>
              <dt>+/-</dt><dd className="mono">{signed(p.plus_minus)}</dd>
            </dl>
          </details>
        </div>
        <div className="player-side">
        <div className="card">
          <h3>{tr("Per game")}</h3>
          <div className="qstrip">
            <div className="q"><b>{(p.pts / Math.max(p.gp, 1)).toFixed(1)}</b><span>PPG</span></div>
            <div className="q"><b>{(p.reb / Math.max(p.gp, 1)).toFixed(1)}</b><span>RPG</span></div>
            <div className="q"><b>{(p.ast / Math.max(p.gp, 1)).toFixed(1)}</b><span>APG</span></div>
            <div className="q"><b>{(p.stl / Math.max(p.gp, 1)).toFixed(1)}</b><span>SPG</span></div>
            <div className="q"><b>{(p.blk / Math.max(p.gp, 1)).toFixed(1)}</b><span>BPG</span></div>
            <div className="q"><b>{(p.eff / Math.max(p.gp, 1)).toFixed(1)}</b><span>EFF</span></div>
          </div>
        </div>
        <div className="card player-radar">
          <h3>{tr("vs group average")} <span className="cn">{tr("per game")}</span></h3>
          <ul className="player-radar-legend" aria-hidden="true">
            {radarSeries.map(({ name, color }) => (
              <li key={color}><span style={{ borderColor: color }} />{name}</li>
            ))}
          </ul>
          <RadarChart axes={axes} series={radarSeries} focused label={radarLabel} />
        </div>
        </div>
      </div>

      <div className="card player-game-log">
        <h3>{tr("Game log")} <span className="cn">比賽表現</span></h3>
        <CsvButton id="gamelog-csv" onDownload={downloadCsv} />
        <SortTable
          columns={GAMELOG_COLS}
          rows={p.games}
          tableId="t-gamelog"
          pin={1}
          sortable={false}
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
              highCell(x, "pts"),
              <td className="num mono" key="2pt">{x.fgm - x.fg3m}-{x.fga - x.fg3a}</td>,
              <td className="num mono" key="3pt">{x.fg3m}-{x.fg3a}</td>,
              <td className="num mono" key="ft">{x.ftm}-{x.fta}</td>,
              highCell(x, "tot_reb"),
              highCell(x, "ast"),
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
