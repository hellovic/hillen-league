import { useEffect, useState } from "react";
import { api } from "../data.js";
import { csvDownload, setTitle } from "../utils.js";
import { ShareButton } from "../components/Buttons.jsx";
import SortTable from "../components/SortTable.jsx";

const BOX_COLS = [
  { kh: "MIN", key: "minutes", num: true },
  { kh: "2PT", key: "fg2m", num: true },
  { kh: "3PT", key: "fg3m", num: true },
  { kh: "FG", key: "fgm", num: true },
  { kh: "FT", key: "ftm", num: true },
  { kh: "PTS", key: "pts", num: true },
  { kh: "REB", key: "tot_reb", num: true },
  { kh: "AST", key: "ast", num: true },
  { kh: "ST", key: "stl", num: true },
  { kh: "BS", key: "blk", num: true },
  { kh: "TO", key: "tov", num: true },
  { kh: "PF", key: "pf", num: true },
  { kh: "EFF", key: "eff", num: true },
  { kh: "+/−", key: "plus_minus", num: true },
];

const BEST_STATS = [
  ["pts", "PTS"], ["fg2m", "2PT"], ["fg3m", "3PT"], ["ftm", "FT"],
  ["tot_reb", "REB"], ["ast", "AST"], ["stl", "ST"], ["blk", "BS"], ["eff", "EFF"],
];

function teamTotals(rows) {
  const a = rows.reduce((acc, b) => {
    ["fg2m", "fg2a", "fg3m", "fg3a", "fgm", "fga", "ftm", "fta", "off_reb", "def_reb", "tot_reb",
      "ast", "stl", "blk", "fb", "ba", "tov", "pf", "eff", "pts"].forEach((k) => {
      acc[k] = (acc[k] || 0) + (b[k] || 0);
    });
    acc.plus_minus += b.plus_minus || 0;
    return acc;
  }, { plus_minus: 0 });
  return a;
}

function sortVal(key, b) {
  if (key === "minutes") {
    const m = String(b.minutes || "0:00").match(/^(\d+):(\d+)$/);
    return m ? +m[1] * 60 + +m[2] : 0;
  }
  return b[key];
}

export default function GameDetail({ ctx, id, onAdoptContext }) {
  const [teamSort, setTeamSort] = useState({});
  let g = null;
  let err = null;
  try {
    g = api("games/" + id);
  } catch (e) {
    err = e;
  }

  useEffect(() => {
    if (g && (g.season_id !== ctx.season || g.group_id !== ctx.group)) {
      onAdoptContext(g.season_id, g.group_id);
    }
  }, [g && g.season_id, g && g.group_id, ctx.season, ctx.group]);

  useEffect(() => {
    if (!g || g.error) {
      setTitle("Not found");
      return;
    }
    const statusNote =
      g.status !== "completed"
        ? g.status === "forfeit" ? "Forfeit" : g.status === "not_played" ? "Not played" : "Scheduled"
        : "";
    setTitle(g.group_name, g.game_date, `${g.home_name} vs ${g.away_name}`, statusNote);
  }, [g && g.event_id]);

  if (err) return <div className="empty">{err.message}</div>;
  if (!g) return null;
  if (g.error) return <div className="empty">{g.error}</div>;

  const hw = g.home_score > g.away_score;
  const aw = g.away_score > g.home_score;
  const qOf = (tid) => (g.quarters || []).find((q) => q.team_id === tid) || {};
  const tsOf = (tid) => (g.team_stats || []).find((s) => s.team_id === tid) || {};
  const boxOf = (tid) => g.box.filter((b) => b.team_id === tid);
  const boxRows = (tid) => {
    const st = teamSort[tid];
    const rows = boxOf(tid);
    if (!st || !st.key) return rows;
    return [...rows].sort((a, b) => {
      const va = sortVal(st.key, a);
      const vb = sortVal(st.key, b);
      const r = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va ?? "").localeCompare(String(vb ?? ""), "zh");
      return st.dir === "desc" ? -r : r;
    });
  };

  const boxColumns = [
    { key: "__jersey", label: "#", num: true, sortable: false },
    { key: "__player", label: "Player", sortable: false },
    ...BOX_COLS.map((c) => ({ key: c.key, label: c.kh, num: c.num })),
  ];

  const boxFooter = (tid) => {
    const totals = teamTotals(boxOf(tid));
    return (
      <tr>
        <td colSpan="3"><b>Team total</b></td>
        <td className="num mono">{totals.fg2m}-{totals.fg2a}</td>
        <td className="num mono">{totals.fg3m}-{totals.fg3a}</td>
        <td className="num mono">{totals.fgm}-{totals.fga}</td>
        <td className="num mono">{totals.ftm}-{totals.fta}</td>
        <td className="num mono">{totals.pts}</td>
        <td className="num">{totals.tot_reb}</td><td className="num">{totals.ast}</td><td className="num">{totals.stl}</td>
        <td className="num">{totals.blk}</td><td className="num">{totals.tov}</td><td className="num">{totals.pf}</td>
        <td className="num">{totals.eff}</td>
        <td className="num">{totals.plus_minus > 0 ? "+" : ""}{totals.plus_minus}</td>
      </tr>
    );
  };

  const renderBoxRow = (b) => {
    const dnp = b.minutes === "0:00";
    return [
      <td className="num mono" key="jersey">{b.jersey_no ?? "—"}</td>,
      <td key="player">
        <a className="row-link nm" title={b.player_name} href={`#/players/${b.player_id}`}>
          {b.player_name}
        </a>
      </td>,
      <td className="num mono" key="min">
        {dnp ? <span className="badge np" aria-label="Did not play">DNP</span> : b.minutes}
      </td>,
      <td className="num mono" key="2pt">{b.fg2m}-{b.fg2a}</td>,
      <td className="num mono" key="3pt">{b.fg3m}-{b.fg3a}</td>,
      <td className="num mono" key="fg">{b.fgm}-{b.fga}</td>,
      <td className="num mono" key="ft">{b.ftm}-{b.fta}</td>,
      <td className="num mono" key="pts">{b.pts}</td>,
      <td className="num" key="reb">{b.tot_reb}</td>,
      <td className="num" key="ast">{b.ast}</td>,
      <td className="num" key="stl">{b.stl}</td>,
      <td className="num" key="blk">{b.blk}</td>,
      <td className="num" key="tov">{b.tov}</td>,
      <td className="num" key="pf">{b.pf}</td>,
      <td className="num" key="eff">{b.eff}</td>,
      <td className={`num ${b.plus_minus >= 0 ? "winner" : "loser"}`} key="pm">
        {b.plus_minus > 0 ? "+" : ""}{b.plus_minus}
      </td>,
    ];
  };

  const downloadBoxCsv = () =>
    csvDownload(
      "box_score.csv",
      ["Team", "Jersey", "Player", "MIN", "2PT", "3PT", "FG", "FT", "REB", "AST", "ST", "BS", "TO", "PF", "EFF", "+/-", "PTS"],
      g.box.map((b) => [
        b.team_id === g.home_team_id ? g.home_name : g.away_name, b.jersey_no, b.player_name,
        b.minutes, `${b.fg2m}-${b.fg2a}`, `${b.fg3m}-${b.fg3a}`, `${b.fgm}-${b.fga}`, `${b.ftm}-${b.fta}`,
        b.tot_reb, b.ast, b.stl, b.blk, b.tov, b.pf, b.eff, b.plus_minus, b.pts,
      ])
    );

  const teamBoxCard = (tid) => {
    const name = tid === g.home_team_id ? g.home_name : g.away_name;
    const color = tsOf(tid).shirt_color;
    const win = tid === g.home_team_id ? hw : aw;
    return (
      <div className="card" key={`box-${tid}`}>
        <h3>
          {name} {color ? <span className="pill">{color}</span> : null}{" "}
          <span className="cn">{win ? "WINNER" : "LOSER"}</span>
          <button className="csv-btn csv-export team-table-csv" type="button" title="Download as CSV" onClick={downloadBoxCsv}>
            CSV
          </button>
        </h3>
        <div id={`box-tbl-${tid}`}>
          <SortTable
            columns={boxColumns}
            rows={boxRows(tid)}
            tableId={`t-box-${tid}`}
            pin={2}
            sort={teamSort[tid] || null}
            onSort={(next) => setTeamSort((prev) => ({ ...prev, [tid]: next }))}
            rowKey={(b) => b.player_id}
            rowHref={(b) => `#/players/${b.player_id}`}
            rowClass={(b) => (b.minutes === "0:00" ? "dnp-row" : undefined)}
            renderRow={renderBoxRow}
            footer={boxFooter(tid)}
            emptyText="No box score"
          />
        </div>
      </div>
    );
  };

  const quarterTable = (() => {
    const h = qOf(g.home_team_id);
    const a = qOf(g.away_team_id);
    const qs = ["q1", "q2", "q3", "q4"];
    if ((h.ot || 0) !== 0 || (a.ot || 0) !== 0) qs.push("ot");
    const labels = qs.map((_, i) => (i < 4 ? "Q" + (i + 1) : "OT"));
    const cells = (team) => qs.map((k) => <td className="num" key={k}>{team[k] ?? "—"}</td>);
    return (
      <table className="data quarter-table">
        <thead>
          <tr><th></th>{labels.map((l) => <th key={l}>{l}</th>)}<th>Total</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{g.home_name}</td>{cells(h)}
            <td className="num total">{g.home_score ?? "—"}</td>
          </tr>
          <tr>
            <td>{g.away_name}</td>{cells(a)}
            <td className="num total">{g.away_score ?? "—"}</td>
          </tr>
        </tbody>
      </table>
    );
  })();

  const leadersFor = (tid, key) => {
    const rows = boxOf(tid);
    const max = Math.max(0, ...rows.map((b) => b[key] || 0));
    if (max === 0) return { players: [{ id: null, name: "NIL" }], value: 0 };
    return { players: rows.filter((b) => (b[key] || 0) === max).map((b) => ({ id: b.player_id, name: b.player_name })), value: max };
  };
  const bestLeaders = (list) =>
    list.map((p, i) =>
      p.id
        ? <div key={i}><a className="row-link" href={`#/players/${p.id}`}>{p.name}</a></div>
        : <div key={i}>{p.name}</div>
    );

  const bestTable = (
    <div className="card">
      <h3>最佳表現 <span className="cn">Best Performance</span></h3>
      <table className="data best-table">
        <thead>
          <tr><th className="side">主隊</th><th className="num"></th><th></th><th className="num"></th><th className="side">客隊</th></tr>
        </thead>
        <tbody>
          {BEST_STATS.map(([key, label]) => {
            const h = leadersFor(g.home_team_id, key);
            const a = leadersFor(g.away_team_id, key);
            return (
              <tr key={key}>
                <td>{bestLeaders(h.players)}</td>
                <td className="num mono">{h.value}</td>
                <td className="bst">{label}</td>
                <td className="num mono">{a.value}</td>
                <td>{bestLeaders(a.players)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <a className="back" href="#/games">← Games</a>
      <div className="view-head">
        <h2 className="game-detail-heading">{g.group_name} · {g.game_date}</h2>
        <div className="toolbar">
          <div className="sub">{g.venue || ""} · {g.start_time || ""}–{g.end_time || ""}</div>
          <ShareButton kind="games" id={id} />
        </div>
      </div>

      <div className="card">
        <div className="scoreboard">
          <div className="team">
            <div className="tname"><a className="row-link" href={`#/teams/${g.home_team_id}`}>{g.home_name}</a></div>
            <div className="tcolor">{tsOf(g.home_team_id).shirt_color || ""}</div>
            <div className={`score ${g.status === "completed" ? (hw ? "winner" : aw ? "loser" : "draw") : "draw"}`}>
              {g.home_score ?? "—"}
            </div>
          </div>
          <div className="vs">–</div>
          <div className="team">
            <div className="tname"><a className="row-link" href={`#/teams/${g.away_team_id}`}>{g.away_name}</a></div>
            <div className="tcolor">{tsOf(g.away_team_id).shirt_color || ""}</div>
            <div className={`score ${g.status === "completed" ? (aw ? "winner" : hw ? "loser" : "draw") : "draw"}`}>
              {g.away_score ?? "—"}
            </div>
          </div>
        </div>
        {g.status === "completed" ? (
          quarterTable
        ) : g.status === "forfeit" ? (
          <div className="empty">
            <b>Forfeit</b> — {hw ? g.home_name : g.away_name} awarded the win ({g.home_score ?? "—"}–{g.away_score ?? "—"} default).
          </div>
        ) : (
          <div className="empty">
            {g.status === "not_played" ? "Game not played (walkover / no result)." : "Scheduled — no result yet."}
          </div>
        )}
      </div>

      {g.status === "completed" ? bestTable : null}
      {g.status === "completed" ? teamBoxCard(g.home_team_id) : null}
      {g.status === "completed" ? teamBoxCard(g.away_team_id) : null}
    </>
  );
}
