import { useEffect, useMemo, useRef, useState } from "react";
import { api, groupName } from "../data.js";
import {
  MISSING,
  cmpRow,
  contextQuery,
  efgPct,
  fmtDate,
  gameStatus,
  go,
  hasResult,
  n1,
  nInt,
  pctStr,
  scoreText,
  setTitle,
  signed,
  sortByKickoff,
  tsPct,
} from "../utils.js";
import { GroupedBars, RadarChart } from "../charts.jsx";
import { usePalette } from "../theme.jsx";
import StatGuide from "../components/StatGuide.jsx";
import { GUIDE_GROUPS } from "../glossary.js";

/* UX-10 / UX-18 — comparison workspace.
 *
 * UX-10: every control has a visible, associated label, and each option carries
 * enough context to tell similar names apart. UX-18: the result leads with a
 * short core table (both identities attached to their numbers), advanced
 * metrics sit behind one disclosure, and the charts either stay legible at
 * phone width or provide a textual data table beside them. The route and the
 * Compare → Copy-link contract are untouched. */

const NOUN = { p: "player", t: "team" };

function toRows(specs) {
  return specs.map(([label, va, vb, lowerBetter]) => cmpRow(label, va, vb, lowerBetter));
}

/* Identity strip: names, team/record context, and the chart-colour key. */
function IdentityStrip({ left, right }) {
  return (
    <div className="cmp-identities">
      <div className="cmp-identity">
        <span className="cmp-swatch" style={{ background: left.color }} aria-hidden="true" />
        <span className="cmp-identity-copy">
          <span className="cmp-identity-name">{left.name}</span>
          {left.sub ? <span className="cmp-identity-sub">{left.sub}</span> : null}
        </span>
      </div>
      <span className="cmp-identity-vs" aria-hidden="true">vs</span>
      <div className="cmp-identity cmp-identity-right">
        <span className="cmp-identity-copy">
          <span className="cmp-identity-name">{right.name}</span>
          {right.sub ? <span className="cmp-identity-sub">{right.sub}</span> : null}
        </span>
        <span className="cmp-swatch" style={{ background: right.color }} aria-hidden="true" />
      </div>
    </div>
  );
}

/* Three-column stat table. The header repeats name + team/record so every
 * value is attached to an identity even when the table is read on its own. */
function CompareTable({ sideA, sideB, rows, className = "", caption }) {
  return (
    <table className={`data cmp-table ${className}`.trim()}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Stat</th>
          <th scope="col" className="num">
            <span className="cmp-th-name">{sideA.name}</span>
            <span className="cmp-th-team">{sideA.sub}</span>
          </th>
          <th scope="col" className="num">
            <span className="cmp-th-name">{sideB.name}</span>
            <span className="cmp-th-team">{sideB.sub}</span>
          </th>
        </tr>
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
  );
}

/* Local horizontal scroller with an honest "swipe" hint that only appears when
 * the table really is wider than its card. Keyboard users get a focusable
 * region, so the scroll is operable without a pointer. */
function ScrollTable({ label, children }) {
  const ref = useRef(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (!ro) {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={`cmp-scroll-wrap${overflow ? " is-scrollable" : ""}`}>
      <div className="cmp-scroll" ref={ref} tabIndex={overflow ? 0 : undefined} role="region" aria-label={label}>
        {children}
      </div>
      <p className="cmp-scroll-hint">Swipe or scroll sideways to see the rest of the table →</p>
    </div>
  );
}

function CoreSection({ sideA, sideB, rows, guide = false }) {
  const title = `Core season comparison: ${sideA.name} vs ${sideB.name}`;
  return (
    <section className="card cmp-core" aria-labelledby="cmp-core-title">
      <div className="cmp-section-head">
        <h3 id="cmp-core-title">Core stats <span className="cn">season averages</span></h3>
        {guide ? <StatGuide items={GUIDE_GROUPS.compare} /> : null}
      </div>
      <ScrollTable label={title}>
        <CompareTable sideA={sideA} sideB={sideB} rows={rows} className="cmp-core-table" caption={title} />
      </ScrollTable>
      <p className="cmp-legend">Highlighted = better value · — = no record</p>
    </section>
  );
}

function AdvancedSection({ sideA, sideB, rows }) {
  const title = `Advanced season comparison: ${sideA.name} vs ${sideB.name}`;
  return (
    <details className="card cmp-advanced">
      <summary className="cmp-advanced-summary">
        <span className="cmp-advanced-label">Advanced metrics</span>
        <span className="cmp-advanced-count">{rows.length} more stats</span>
        <span className="cmp-advanced-caret" aria-hidden="true" />
      </summary>
      <div className="cmp-advanced-body">
        <ScrollTable label={title}>
          <CompareTable sideA={sideA} sideB={sideB} rows={rows} className="cmp-adv-table" caption={title} />
        </ScrollTable>
      </div>
    </details>
  );
}

/* Chart legend rendered as HTML so it stays at body-text size on a phone; the
 * SVG legend is hidden at that width, where it renders around 4–5 px. */
function ChartLegend({ items }) {
  return (
    <div className="cmp-chart-legend">
      {items.map((item) => (
        <span key={item.name}>
          <i style={{ background: item.color }} aria-hidden="true" />
          {item.name}
        </span>
      ))}
    </div>
  );
}

/* A data table that is visible on phones (where the SVG labels are small) and
 * screen-reader-only on wider screens, so chart data always has a text form. */
function ChartData({ caption, headers, rows }) {
  return (
    <div className="cmp-chart-data">
      <table className="data cmp-trend-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map(([label, numeric]) => (
              <th key={label} scope="col" className={numeric ? "num" : ""}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={headers[j][1] ? "num" : ""}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerTrend({ p, color }) {
  const games = sortByKickoff(p.games || []);
  return (
    <div className="card cmp-trend">
      <h3>{p.player_name} — points per game</h3>
      {games.length ? (
        <>
          <ChartLegend items={[{ name: "PTS", color }]} />
          <div className="cmp-trend-chart" aria-hidden="true">
            <GroupedBars
              rows={games.map((x) => ({ label: fmtDate(x.game_date), values: [x.pts] }))}
              series={[{ name: "PTS", color }]}
            />
          </div>
          <ChartData
            caption={`${p.player_name} points by game`}
            headers={[["Date", false], ["PTS", true]]}
            rows={games.map((x) => [fmtDate(x.game_date), x.pts])}
          />
        </>
      ) : (
        <div className="chart-empty">No games.</div>
      )}
    </div>
  );
}

function PlayerProfile({ pa, pb, palette }) {
  const g = (p) => Math.max(p.gp, 1);
  const metrics = [
    ["PTS", pa.pts / g(pa), pb.pts / g(pb)],
    ["REB", pa.reb / g(pa), pb.reb / g(pb)],
    ["AST", pa.ast / g(pa), pb.ast / g(pb)],
    ["STL", pa.stl / g(pa), pb.stl / g(pb)],
    ["BLK", pa.blk / g(pa), pb.blk / g(pb)],
    ["EFF", pa.eff / g(pa), pb.eff / g(pb)],
  ];
  return (
    <section className="card cmp-profile" aria-label={`Per-game profile: ${pa.player_name} vs ${pb.player_name}`}>
      <h3>Per-game profile <span className="cn">side by side</span></h3>
      <div className="cmp-bars">
        <div className="cmp-bars-head">
          <span aria-hidden="true" />
          <span className="cmp-bars-name">
            <span className="cmp-swatch" style={{ background: palette[0] }} aria-hidden="true" />
            {pa.player_name}
          </span>
          <span className="cmp-bars-name">
            <span className="cmp-swatch" style={{ background: palette[1] }} aria-hidden="true" />
            {pb.player_name}
          </span>
        </div>
        {metrics.map(([label, va, vb]) => {
          const max = Math.max(va, vb, 0.1);
          const width = (v) => `${v > 0 ? Math.max(2, (v / max) * 100) : 0}%`;
          return (
            <div className="cmp-bar-row" key={label}>
              <span className="cmp-bar-label">{label}</span>
              <span className="cmp-bar-cell">
                <b>{n1(va)}</b>
                <span className="cmp-bar-track">
                  <span className="cmp-bar-fill" style={{ width: width(va), background: palette[0] }} />
                </span>
              </span>
              <span className="cmp-bar-cell">
                <b>{n1(vb)}</b>
                <span className="cmp-bar-track">
                  <span className="cmp-bar-fill" style={{ width: width(vb), background: palette[1] }} />
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComparePlayers({ pa, pb, palette }) {
  const g = (p) => Math.max(p.gp, 1);
  const per = (v, p) => (p.gp ? n1(v / p.gp) : MISSING);
  const pct = (m, a) => pctStr(a ? (m / a) * 100 : null);
  const sideA = { name: pa.player_name, sub: pa.team_name, color: palette[0] };
  const sideB = { name: pb.player_name, sub: pb.team_name, color: palette[1] };

  const coreRows = toRows([
    ["Games played", nInt(pa.gp), nInt(pb.gp)],
    ["Points / game", per(pa.pts, pa), per(pb.pts, pb)],
    ["Rebounds / game", per(pa.reb, pa), per(pb.reb, pb)],
    ["Assists / game", per(pa.ast, pa), per(pb.ast, pb)],
    ["Steals / game", per(pa.stl, pa), per(pb.stl, pb)],
    ["Blocks / game", per(pa.blk, pa), per(pb.blk, pb)],
    ["Efficiency / game", per(pa.eff, pa), per(pb.eff, pb)],
    ["FG%", pct(pa.fgm, pa.fga), pct(pb.fgm, pb.fga)],
  ]);

  const advRows = toRows([
    ["Minutes / game", per(pa.minutes, pa), per(pb.minutes, pb)],
    ["Total points", nInt(pa.pts), nInt(pb.pts)],
    ["Turnovers / game", per(pa.tov, pa), per(pb.tov, pb), true],
    ["Fouls / game", per(pa.pf, pa), per(pb.pf, pb), true],
    ["3P%", pct(pa.fg3m, pa.fg3a), pct(pb.fg3m, pb.fg3a)],
    ["FT%", pct(pa.ftm, pa.fta), pct(pb.ftm, pb.fta)],
    ["eFG%", pctStr(efgPct(pa.fgm, pa.fga, pa.fg3m)), pctStr(efgPct(pb.fgm, pb.fga, pb.fg3m))],
    ["TS%", pctStr(tsPct(pa.pts, pa.fga, pa.fta)), pctStr(tsPct(pb.pts, pb.fga, pb.fta))],
    ["+/− (season)", signed(pa.plus_minus), signed(pb.plus_minus)],
    ["Fast-break pts", nInt(pa.fb), nInt(pb.fb)],
    ["Blocked against", nInt(pa.ba), nInt(pb.ba), true],
  ]);

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
      <table className="data h2h-player-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>{pa.player_name} ({pa.team_name})</th>
            <th>{pb.player_name} ({pb.team_name})</th>
          </tr>
        </thead>
        <tbody>
          {shared.map((id) => (
            <tr
              key={id}
              tabIndex={0}
              data-href={`#/games/${id}`}
              onClick={(e) => {
                if (e.target.closest("a")) return;
                go(`#/games/${id}`);
              }}
              onKeyDown={(e) => {
                if (e.target.closest("a")) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  go(`#/games/${id}`);
                }
              }}
            >
              <td className="h2h-date">{gamesA.get(id).game_date}</td>
              <td className="mono h2h-line">
                <span className="h2h-tag">{pa.player_name}</span>
                <span>{line(gamesA.get(id))}</span>
              </td>
              <td className="mono h2h-line">
                <span className="h2h-tag">{pb.player_name}</span>
                <span>{line(gamesB.get(id))}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  })();

  return (
    <>
      <IdentityStrip left={sideA} right={sideB} />
      <CoreSection sideA={sideA} sideB={sideB} rows={coreRows} guide />
      <AdvancedSection sideA={sideA} sideB={sideB} rows={advRows} />
      <div className="card compare-radar-card">
        <h3>Per-game profile <span className="cn">vs each other</span></h3>
        <div aria-hidden="true">{radar}</div>
      </div>
      <PlayerProfile pa={pa} pb={pb} palette={palette} />
      <div className="grid-2">
        <PlayerTrend p={pa} color={palette[0]} />
        <PlayerTrend p={pb} color={palette[1]} />
      </div>
      <div className="card">
        <h3>Head-to-head <span className="cn">meetings</span></h3>
        {h2h}
      </div>
    </>
  );
}

function TeamTrend({ t, palette }) {
  const games = sortByKickoff((t.games || []).filter(hasResult));
  if (!games.length) return <div className="chart-empty">No completed games.</div>;
  const rows = games.map((x) => {
    const isHome = x.home_team_id === t.team_id;
    const pf = isHome ? x.home_score : x.away_score;
    const pa = isHome ? x.away_score : x.home_score;
    const result = pf > pa ? "W" : pf < pa ? "L" : "T";
    return { label: fmtDate(x.game_date), values: [pf, pa], result };
  });
  return (
    <>
      <ChartLegend items={[
        { name: "PF", color: palette[2] },
        { name: "PA", color: palette[3] },
      ]} />
      <div className="cmp-trend-chart" aria-hidden="true">
        <GroupedBars
          rows={rows}
          series={[
            { name: "PF", color: palette[2] },
            { name: "PA", color: palette[3] },
          ]}
          showValues
          h={170}
        />
      </div>
      <ChartData
        caption={`${t.team_name} scoring by game`}
        headers={[["Date", false], ["Result", false], ["PF", true], ["PA", true]]}
        rows={rows.map((r) => [r.label, r.result, r.values[0], r.values[1]])}
      />
    </>
  );
}

function TeamHeadToHead({ ta, tb }) {
  const idsB = new Set(tb.games.map((x) => x.event_id));
  const shared = sortByKickoff(ta.games.filter((x) => idsB.has(x.event_id)));
  if (!shared.length) {
    return <div className="h2h-record">These teams never met this season.</div>;
  }
  const played = shared.filter(hasResult);
  const series = played.reduce(
    (acc, x) => {
      const isHome = x.home_team_id === ta.team_id;
      const aScore = isHome ? x.home_score : x.away_score;
      const bScore = isHome ? x.away_score : x.home_score;
      if (aScore === bScore) acc.draw += 1;
      else if (aScore > bScore) acc.a += 1;
      else acc.b += 1;
      return acc;
    },
    { a: 0, b: 0, draw: 0 },
  );
  return (
    <>
      <table className="data h2h-team-table">
        <thead>
          <tr><th>Date</th><th>Score</th><th>Venue</th><th className="num">Result</th></tr>
        </thead>
        <tbody>
          {shared.map((x) => {
            const isHome = x.home_team_id === ta.team_id;
            const aScore = isHome ? x.home_score : x.away_score;
            const bScore = isHome ? x.away_score : x.home_score;
            const result = !hasResult(x)
              ? gameStatus(x).label
              : aScore > bScore
                ? ta.team_name
                : bScore > aScore
                  ? tb.team_name
                  : "Draw";
            return (
              <tr
                key={x.event_id}
                tabIndex={0}
                data-href={`#/games/${x.event_id}`}
                onClick={(e) => {
                  if (e.target.closest("a")) return;
                  go(`#/games/${x.event_id}`);
                }}
                onKeyDown={(e) => {
                  if (e.target.closest("a")) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    go(`#/games/${x.event_id}`);
                  }
                }}
              >
                <td data-label="Date">{x.game_date}</td>
                <td data-label="Score" className="mono">{scoreText(x)}</td>
                <td data-label="Venue">{x.venue || "—"}</td>
                <td data-label="Result" className="num">{result}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {played.length ? (
        <div className="h2h-record">
          Series: <b>{ta.team_name} {series.a}</b> – <b>{series.b} {tb.team_name}</b>
          {series.draw ? ` · ${series.draw} drawn` : ""}
        </div>
      ) : (
        <div className="h2h-record">No completed meetings yet this season.</div>
      )}
    </>
  );
}

function CompareTeams({ ta, tb, palette }) {
  const per = (v, gp) => (gp ? n1(v / gp) : MISSING);
  const diff = (t) => t.pts_for - t.pts_against;
  const sideA = { name: ta.team_name, sub: `${ta.wins}-${ta.losses}`, color: palette[2] };
  const sideB = { name: tb.team_name, sub: `${tb.wins}-${tb.losses}`, color: palette[3] };

  const coreRows = toRows([
    ["Games played", nInt(ta.gp), nInt(tb.gp)],
    ["Wins", nInt(ta.wins), nInt(tb.wins)],
    ["Losses", nInt(ta.losses), nInt(tb.losses), true],
    ["Points for", nInt(ta.pts_for), nInt(tb.pts_for)],
    ["Points against", nInt(ta.pts_against), nInt(tb.pts_against), true],
    ["Point differential", signed(diff(ta)), signed(diff(tb))],
  ]);

  const advRows = toRows([
    ["Points for / game", per(ta.pts_for, ta.gp), per(tb.pts_for, tb.gp)],
    ["Points against / game", per(ta.pts_against, ta.gp), per(tb.pts_against, tb.gp), true],
    ["Win %", ta.gp ? pctStr((ta.wins / ta.gp) * 100) : MISSING, tb.gp ? pctStr((tb.wins / tb.gp) * 100) : MISSING],
    ["Differential / game", ta.gp ? n1(diff(ta) / ta.gp) : MISSING, tb.gp ? n1(diff(tb) / tb.gp) : MISSING],
  ]);

  return (
    <>
      <IdentityStrip left={sideA} right={sideB} />
      <CoreSection sideA={sideA} sideB={sideB} rows={coreRows} />
      <AdvancedSection sideA={sideA} sideB={sideB} rows={advRows} />
      <div className="grid-2">
        <div className="card cmp-trend">
          <h3>{ta.team_name} — scoring by game</h3>
          <TeamTrend t={ta} palette={palette} />
        </div>
        <div className="card cmp-trend">
          <h3>{tb.team_name} — scoring by game</h3>
          <TeamTrend t={tb} palette={palette} />
        </div>
      </div>
      <div className="card">
        <h3>Head-to-head <span className="cn">series</span></h3>
        <TeamHeadToHead ta={ta} tb={tb} />
      </div>
    </>
  );
}

export default function CompareView({ ctx, type, a, b }) {
  const kind = type === "t" ? "t" : "p";
  const palette = usePalette();
  /* The pickers have to hold a half-finished choice: the URL only carries a
   * comparison once both sides are picked, so the selects are local state that
   * mirrors the route and is committed when the second side arrives. Without
   * this the controlled selects snapped back to "— choose —" after every
   * change and the page could only be used through a deep link. */
  const [pickA, setPickA] = useState(a ?? "");
  const [pickB, setPickB] = useState(b ?? "");
  useEffect(() => {
    setPickA(a ?? "");
    setPickB(b ?? "");
  }, [a, b, kind, ctx.season, ctx.group]);
  const idKey = kind === "p" ? "player_id" : "team_id";
  const nameKey = kind === "p" ? "player_name" : "team_name";
  const noun = NOUN[kind];
  const gname = groupName(ctx.season, ctx.group);

  let list = [];
  try {
    list = api(kind === "p" ? "players" : "teams", ctx);
  } catch (e) {
    list = [];
  }

  const pickedName = (id) => {
    if (!id) return "";
    const hit = list.find((it) => String(it[idKey]) === String(id));
    return hit ? hit[nameKey] : "";
  };
  const pickedA = pickedName(pickA);
  const pickedB = pickedName(pickB);

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

  let emptyMessage;
  if (pickedA && !pickedB) {
    emptyMessage = `First ${noun}: ${pickedA}. Now choose a second ${noun} to open the comparison.`;
  } else if (pickedB && !pickedA) {
    emptyMessage = `Second ${noun}: ${pickedB}. Now choose a first ${noun} to open the comparison.`;
  } else {
    emptyMessage = `Choose a first ${noun} and a second ${noun} above. Both sides are required.`;
  }

  return (
    <>
      <div className="view-head">
        <h2>Compare</h2>
        <div className="sub">Season {ctx.season} · {gname}</div>
      </div>
      <div className="card compare-card">
        <div className="compare-pickers">
          <div className="cmp-field">
            <label htmlFor="cmp-type">Compare</label>
            <select id="cmp-type" value={kind} onChange={(e) => goCompare(e.target.value, null, null)}>
              <option value="p">Players</option>
              <option value="t">Teams</option>
            </select>
          </div>
          <div className="cmp-field">
            <label htmlFor="cmp-a">{kind === "p" ? "First player" : "First team"}</label>
            <select
              id="cmp-a"
              value={pickA}
              onChange={(e) => {
                const id = +e.target.value || null;
                setPickA(id ?? "");
                if (id && pickB) goCompare(kind, id, pickB);
                /* Clearing a side must clear the comparison too, or the
                 * picker says "choose" while the old result stays on screen. */
                else if (!id) goCompare(kind, null, null);
              }}
            >
              <option value="">— choose —</option>
              {list.map((it) => (
                <option key={kind === "p" ? `${it[idKey]}-${it.team_id}` : it[idKey]} value={it[idKey]}>
                  {kind === "p" ? `${it.player_name} (${it.team_name})` : it.team_name}
                </option>
              ))}
            </select>
          </div>
          <span className="cmp-vs" aria-hidden="true">vs</span>
          <div className="cmp-field">
            <label htmlFor="cmp-b">{kind === "p" ? "Second player" : "Second team"}</label>
            <select
              id="cmp-b"
              value={pickB}
              onChange={(e) => {
                const id = +e.target.value || null;
                setPickB(id ?? "");
                if (id && pickA) goCompare(kind, pickA, id);
                /* Clearing a side must clear the comparison too, or the
                 * picker says "choose" while the old result stays on screen. */
                else if (!id) goCompare(kind, null, null);
              }}
            >
              <option value="">— choose —</option>
              {list.map((it) => (
                <option key={kind === "p" ? `${it[idKey]}-${it.team_id}` : it[idKey]} value={it[idKey]}>
                  {kind === "p" ? `${it.player_name} (${it.team_name})` : it.team_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div id="cmp-result">
          {result || (
            <div className="cmp-empty">
              <p className="cmp-empty-title">{pickedA || pickedB ? "One side picked" : "Start a comparison"}</p>
              <p className="cmp-empty-body">{emptyMessage}</p>
              <p className="cmp-empty-tip">
                Tip: open a {noun}’s page and press Compare, or use a shared comparison link.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
