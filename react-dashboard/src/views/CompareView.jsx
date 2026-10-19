import { useEffect, useMemo, useState } from "react";
import { api, groupName } from "../data.js";
import { contextQuery, fmtDate, go, setTitle } from "../utils.js";
import { GroupedBars, RadarChart } from "../charts.jsx";
import { usePalette } from "../theme.jsx";

/* one comparison row; better value gets .hi (numeric comparison!) */
function cmpRow(label, va, vb, lowerBetter = false) {
  const num = (v) => (v === null || v === undefined || v === "" ? "—" : v);
  const numv = (v) => (typeof v === "number" ? v : parseFloat(v));
  const better = (x, y) => {
    const nx = numv(x), ny = numv(y);
    if (isNaN(nx) || isNaN(ny) || nx === ny) return "";
    return (nx > ny) !== lowerBetter ? "hi" : "lo";
  };
  return { label, a: num(va), b: num(vb), clsA: better(va, vb), clsB: better(vb, va) };
}

function ComparePlayers({ pa, pb, palette }) {
  const g = (p) => Math.max(p.gp, 1);
  const pct = (m, a) => (a ? ((m / a) * 100).toFixed(1) + "%" : "—");
  const rows = [
    ["Games played", pa.gp, pb.gp, false],
    ["Minutes / game", (pa.minutes / g(pa)).toFixed(1), (pb.minutes / g(pb)).toFixed(1), false],
    ["Points / game", (pa.pts / g(pa)).toFixed(1), (pb.pts / g(pb)).toFixed(1), false],
    ["Total points", pa.pts, pb.pts, false],
    ["Rebounds / game", (pa.reb / g(pa)).toFixed(1), (pb.reb / g(pb)).toFixed(1), false],
    ["Assists / game", (pa.ast / g(pa)).toFixed(1), (pb.ast / g(pb)).toFixed(1), false],
    ["Steals / game", (pa.stl / g(pa)).toFixed(1), (pb.stl / g(pb)).toFixed(1), false],
    ["Blocks / game", (pa.blk / g(pa)).toFixed(1), (pb.blk / g(pb)).toFixed(1), false],
    ["Efficiency / game", (pa.eff / g(pa)).toFixed(1), (pb.eff / g(pb)).toFixed(1), false],
    ["Turnovers / game", (pa.tov / g(pa)).toFixed(1), (pb.tov / g(pb)).toFixed(1), true],
    ["Fouls / game", (pa.pf / g(pa)).toFixed(1), (pb.pf / g(pb)).toFixed(1), true],
    ["FG%", pct(pa.fgm, pa.fga), pct(pb.fgm, pb.fga), false],
    ["3P%", pct(pa.fg3m, pa.fg3a), pct(pb.fg3m, pb.fg3a), false],
    ["FT%", pct(pa.ftm, pa.fta), pct(pb.ftm, pb.fta), false],
    ["eFG%", pct(pa.fgm + 0.5 * pa.fg3m, pa.fga), pct(pb.fgm + 0.5 * pb.fg3m, pb.fga), false],
    ["TS%", pct(pa.pts, 2 * (pa.fga + 0.44 * pa.fta)), pct(pb.pts, 2 * (pb.fga + 0.44 * pb.fta)), false],
    ["+/- (season)", pa.plus_minus, pb.plus_minus, false],
    ["Fast-break pts", pa.fb, pb.fb, false],
    ["Blocked against", pa.ba, pb.ba, true],
  ].map((r) => cmpRow(r[0], r[1], r[2], r[3]));

  const radarMax = (k) => Math.max(pa[k] / g(pa), pb[k] / g(pb), 0.1) * 1.2;
  const axes = ["pts", "reb", "ast", "stl", "blk", "eff"].map((k) => ({
    label: k.toUpperCase(),
    max: radarMax(k),
  }));
  const radar = (
    <RadarChart
      axes={axes}
      series={[
        {
          name: pa.player_name,
          color: palette[0],
          values: ["pts", "reb", "ast", "stl", "blk", "eff"].map((k) => pa[k] / g(pa)),
        },
        {
          name: pb.player_name,
          color: palette[1],
          values: ["pts", "reb", "ast", "stl", "blk", "eff"].map((k) => pb[k] / g(pb)),
        },
      ]}
    />
  );

  const ptsBars = (p) =>
    p.games.length ? (
      <GroupedBars
        rows={p.games.map((x) => ({ label: fmtDate(x.game_date), values: [x.pts] }))}
        series={[{ name: "PTS", color: palette[0] }]}
      />
    ) : (
      <div className="chart-empty">No games.</div>
    );

  const h2h = (() => {
    if (pa.team_id === pb.team_id) return <div className="h2h-record">Same team — no head-to-head.</div>;
    const gamesA = new Map(pa.games.map((x) => [x.event_id, x]));
    const gamesB = new Map(pb.games.map((x) => [x.event_id, x]));
    const shared = [...gamesA.keys()].filter((id) => gamesB.has(id)).sort();
    if (!shared.length) {
      return <div className="h2h-record">{pa.team_name} and {pb.team_name} never met this season.</div>;
    }
    const line = (entry) => {
      const isHome = entry.home_team_id === entry.team_id;
      const mine = isHome ? entry.home_score : entry.away_score;
      const opp = isHome ? entry.away_score : entry.home_score;
      return `${mine > opp ? "W" : mine < opp ? "L" : "T"} ${entry.pts}pts ${entry.tot_reb}reb ${entry.ast}ast`;
    };
    return (
      <table className="data">
        <thead>
          <tr>
            <th>Date</th>
            <th>{pa.player_name} ({pa.team_name})</th>
            <th>{pb.player_name} ({pb.team_name})</th>
          </tr>
        </thead>
        <tbody>
          {shared.map((id) => (
            <tr key={id} tabIndex={0} data-href={`#/games/${id}`} onClick={() => go(`#/games/${id}`)}>
              <td>{gamesA.get(id).game_date}</td>
              <td className="mono">{line(gamesA.get(id))}</td>
              <td className="mono">{line(gamesB.get(id))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  })();

  return (
    <>
      <div className="grid-2">
        <div className="card"><h3>{pa.player_name} <span className="cn">{pa.team_name}</span></h3></div>
        <div className="card"><h3>{pb.player_name} <span className="cn">{pb.team_name}</span></h3></div>
      </div>
      <div className="card">
        <h3>Season comparison</h3>
        <table className="data">
          <thead>
            <tr><th>Stat</th><th className="num">{pa.player_name}</th><th className="num">{pb.player_name}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className={`num ${r.clsA}`}>{r.a}</td>
                <td className={`num ${r.clsB}`}>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card"><h3>Per-game profile <span className="cn">vs each other</span></h3>{radar}</div>
      <div className="grid-2">
        <div className="card"><h3>{pa.player_name} — points per game</h3>{ptsBars(pa)}</div>
        <div className="card"><h3>{pb.player_name} — points per game</h3>{ptsBars(pb)}</div>
      </div>
      <div className="card"><h3>Head-to-head <span className="cn">meetings</span></h3>{h2h}</div>
    </>
  );
}

function CompareTeams({ ta, tb, palette }) {
  const trend = (t) => {
    const games = t.games.filter((x) => x.status === "completed").sort((a, b) => a.game_date.localeCompare(b.game_date));
    if (!games.length) return <div className="chart-empty">No completed games.</div>;
    return (
      <GroupedBars
        rows={games.map((x) => {
          const pf = x.home_team_id === t.team_id ? x.home_score : x.away_score;
          const pa = x.home_team_id === t.team_id ? x.away_score : x.home_score;
          const r = pf > pa ? "W" : pf < pa ? "L" : "T";
          return { label: `${fmtDate(x.game_date)} ${r}`, values: [pf, pa] };
        })}
        series={[
          { name: "Scored (PF)", color: palette[2] },
          { name: "Conceded (PA)", color: palette[3] },
        ]}
        showValues
        h={170}
      />
    );
  };
  const idsB = new Set(tb.games.map((x) => x.event_id));
  const shared = ta.games.filter((x) => idsB.has(x.event_id)).sort((a, b) => a.game_date.localeCompare(b.game_date));
  const series = shared.reduce((acc, x) => {
    const aWin = x.home_team_id === ta.team_id ? x.home_score > x.away_score : x.away_score > x.home_score;
    acc[aWin ? "a" : "b"]++;
    return acc;
  }, { a: 0, b: 0 });

  const qstrip = (t) => (
    <div className="qstrip">
      <div className="q"><b>{t.gp}</b><span>GP</span></div>
      <div className="q"><b>{t.wins}-{t.losses}</b><span>W-L</span></div>
      <div className="q"><b>{t.pts_for}</b><span>PF</span></div>
      <div className="q"><b>{t.pts_against}</b><span>PA</span></div>
    </div>
  );

  return (
    <>
      <div className="grid-2">
        <div className="card"><h3>{ta.team_name}</h3>{qstrip(ta)}</div>
        <div className="card"><h3>{tb.team_name}</h3>{qstrip(tb)}</div>
      </div>
      <div className="grid-2">
        <div className="card"><h3>{ta.team_name} — scoring by game</h3>{trend(ta)}</div>
        <div className="card"><h3>{tb.team_name} — scoring by game</h3>{trend(tb)}</div>
      </div>
      <div className="card">
        <h3>Head-to-head <span className="cn">series</span></h3>
        {shared.length ? (
          <>
            <table className="data">
              <thead>
                <tr><th>Date</th><th>Score</th><th>Venue</th><th className="num">Winner</th></tr>
              </thead>
              <tbody>
                {shared.map((x) => {
                  const aHome = x.home_team_id === ta.team_id;
                  const aScore = aHome ? x.home_score : x.away_score;
                  const bScore = aHome ? x.away_score : x.home_score;
                  const winner = aScore > bScore ? ta.team_name : bScore > aScore ? tb.team_name : "Draw";
                  return (
                    <tr key={x.event_id} tabIndex={0} data-href={`#/games/${x.event_id}`} onClick={() => go(`#/games/${x.event_id}`)}>
                      <td>{x.game_date}</td>
                      <td className="mono">{aScore}–{bScore}</td>
                      <td>{x.venue || "—"}</td>
                      <td>{winner}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="h2h-record">Series: <b>{ta.team_name} {series.a}</b> – <b>{series.b} {tb.team_name}</b></div>
          </>
        ) : (
          <div className="h2h-record">These teams never met this season.</div>
        )}
      </div>
    </>
  );
}

export default function CompareView({ ctx, type, a, b }) {
  const kind = type === "t" ? "t" : "p";
  const palette = usePalette();
  const [notice, setNotice] = useState("");
  const idKey = kind === "p" ? "player_id" : "team_id";
  const nameKey = kind === "p" ? "player_name" : "team_name";
  const gname = groupName(ctx.season, ctx.group);

  let list = [];
  try {
    list = api(kind === "p" ? "players" : "teams", ctx);
  } catch (e) {
    list = [];
  }

  const names = useMemo(() => {
    if (!a || !b) return null;
    try {
      if (kind === "p") {
        const pa = api("players/" + a, ctx);
        const pb = api("players/" + b, ctx);
        return [`${pa.player_name} vs ${pb.player_name}`, "Compare", "Season " + ctx.season];
      }
      const ta = api("teams/" + a, { season: ctx.season });
      const tb = api("teams/" + b, { season: ctx.season });
      return [`${ta.team_name} vs ${tb.team_name}`, "Compare", "Season " + ctx.season];
    } catch (e) {
      return null;
    }
  }, [kind, a, b, ctx.season, ctx.group]);

  useEffect(() => {
    setTitle(...(names || ["Compare", "Season " + ctx.season]));
  }, [names && names.join("|")]);

  const goCompare = (t, idA, idB) => {
    const base = `#/compare/${t}`;
    if (idA && idB) go(`${base}/${idA}/${idB}${contextQuery(ctx)}`);
    else go(base + contextQuery(ctx));
  };

  let result = null;
  if (a && b) {
    try {
      if (kind === "p") {
        const pa = api("players/" + a, ctx);
        const pb = api("players/" + b, ctx);
        result = <ComparePlayers pa={pa} pb={pb} palette={palette} />;
      } else {
        const ta = api("teams/" + a, { season: ctx.season });
        const tb = api("teams/" + b, { season: ctx.season });
        result = <CompareTeams ta={ta} tb={tb} palette={palette} />;
      }
    } catch (e) {
      result = <div className="empty">{e.message}</div>;
    }
  }

  return (
    <>
      <div className="view-head">
        <h2>Compare</h2>
        <div className="sub">Season {ctx.season} · {gname}</div>
      </div>
      <div className="card">
        <div className="compare-pickers">
          <select id="cmp-type" value={kind} onChange={(e) => goCompare(e.target.value, null, null)}>
            <option value="p">Players</option>
            <option value="t">Teams</option>
          </select>
          <select
            id="cmp-a"
            value={a ?? ""}
            onChange={(e) => {
              const id = +e.target.value || null;
              if (id && b) goCompare(kind, id, b);
              else setNotice(`Choose two ${kind === "p" ? "players" : "teams"} to compare.`);
            }}
          >
            <option value="">— choose —</option>
            {list.map((it) => (
              <option key={it[idKey]} value={it[idKey]}>{it[nameKey]}</option>
            ))}
          </select>
          <span className="vs-badge">VS</span>
          <select
            id="cmp-b"
            value={b ?? ""}
            onChange={(e) => {
              const id = +e.target.value || null;
              if (id && a) goCompare(kind, a, id);
              else setNotice(`Choose two ${kind === "p" ? "players" : "teams"} to compare.`);
            }}
          >
            <option value="">— choose —</option>
            {list.map((it) => (
              <option key={it[idKey]} value={it[idKey]}>{it[nameKey]}</option>
            ))}
          </select>
        </div>
        <div id="cmp-result">
          {result || <div className="empty">{notice || `Choose two ${kind === "p" ? "players" : "teams"} to compare.`}</div>}
        </div>
      </div>
    </>
  );
}
