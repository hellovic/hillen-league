import { useEffect, useMemo, useState } from "react";
import { api, groupName } from "../data.js";
import { csvDownload, efgPct, n1, pct1, pctStr, setTitle, signed, sortRows, tsPct } from "../utils.js";
import { CsvButton } from "../components/Buttons.jsx";
import MobileColumnsToggle from "../components/MobileColumnsToggle.jsx";
import SortTable from "../components/SortTable.jsx";
import StatGuide from "../components/StatGuide.jsx";
import { GUIDE_GROUPS } from "../glossary.js";

const KEYS = [
  { key: "player_name", label: "Player" },
  { key: "team_name", label: "Team" },
  { key: "gp", label: "GP", num: true },
  { key: "minutes", label: "MIN", num: true },
  { key: "ppg", label: "PPG", num: true },
  { key: "pts", label: "PTS", num: true },
  { key: "rpg", label: "RPG", num: true },
  { key: "apg", label: "APG", num: true },
  { key: "spg", label: "SPG", num: true },
  { key: "bpg", label: "BPG", num: true },
  { key: "effpg", label: "EFF", num: true },
  { key: "plus_minus", label: "+/-", num: true },
  { key: "fg_pct", label: "FG%", num: true },
  { key: "fg3_pct", label: "3P%", num: true },
  { key: "efg", label: "eFG%", num: true },
  { key: "ts", label: "TS%", num: true },
];

export default function PlayersView({ ctx }) {
  const rows0 = api("players", ctx);
  const [q, setQ] = useState("");
  /* default order is points desc, but no header marker until a click — same as
   the vanilla build, which sorts rows without touching state.sort */
  const [sort, setSort] = useState(null);
  /* Phone column budget: the compact five/six-column view is the default, the
   * toggle reveals the full 16 columns. CSS does the hiding (ux-tables.css), so
   * desktop markup and width are unchanged. */
  const [allCols, setAllCols] = useState(false);

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Players", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  const players = useMemo(
    () =>
      rows0.map((p) => ({
        ...p,
        efg: efgPct(p.fgm, p.fga, p.fg3m),
        ts: tsPct(p.pts, p.fga, p.fta),
        /* The player rows carry shooting attempts, not the fg_pct/fg3_pct
         * fields the columns are named after, so derive them here: they are
         * rendered as percentages and now sort numerically too. */
        fg_pct: p.fga ? (p.fgm / p.fga) * 100 : null,
        fg3_pct: p.fg3a ? (p.fg3m / p.fg3a) * 100 : null,
      })),
    [rows0]
  );

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return players;
    return players.filter(
      (p) => p.player_name.toLowerCase().includes(needle) || p.team_name.toLowerCase().includes(needle)
    );
  }, [players, q]);

  const rows = sortRows(filtered, sort?.key || "pts", sort?.dir || "desc");

  const downloadCsv = () =>
    csvDownload(
      "players.csv",
      ["Player", "Team", "GP", "MIN", "PPG", "PTS", "RPG", "APG", "SPG", "BPG", "EFF", "+/-", "FG%", "3P%", "eFG%", "TS%"],
      rows.map((p) => [
        p.player_name, p.team_name, p.gp, p.minutes.toFixed(1), p.ppg, p.pts, p.rpg, p.apg,
        p.spg, p.bpg, p.effpg,
        p.plus_minus === undefined || p.plus_minus === null ? "" : p.plus_minus,
        p.fga ? ((p.fgm / p.fga) * 100).toFixed(1) : "",
        p.fg3a ? ((p.fg3m / p.fg3a) * 100).toFixed(1) : "",
        p.efg === null ? "" : p.efg.toFixed(1),
        p.ts === null ? "" : p.ts.toFixed(1),
      ])
    );

  return (
    <>
      <div className="view-head">
        <h2>Players</h2>
        <div className="toolbar">
          <input
            type="search"
            id="player-search"
            placeholder="Search name / team…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="sub">{players.length} players</div>
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Player statistics</h3>
          <StatGuide items={GUIDE_GROUPS.players} />
        </div>
        <MobileColumnsToggle
          controls="t-players"
          expanded={allCols}
          onToggle={() => setAllCols((v) => !v)}
          label="Advanced stats"
        />
        <div id="players-table">
          <SortTable
            columns={KEYS}
            rows={rows}
            tableId="t-players"
            pin={1}
            compact="players"
            compactExpanded={allCols}
            sort={sort}
            onSort={(next) => setSort(next)}
            /* A mid-season mover has one row per team; player_id alone would
             * duplicate the React key. */
            rowKey={(p) => `${p.player_id}-${p.team_id}`}
            rowHref={(p) => `#/players/${p.player_id}`}
            renderRow={(p) => {
              const fgp = pct1(p.fga ? (p.fgm / p.fga) * 100 : null);
              const t3p = pct1(p.fg3a ? (p.fg3m / p.fg3a) * 100 : null);
              const pm = p.plus_minus === undefined || p.plus_minus === null ? null : p.plus_minus;
              return [
                <td key="name">
                  <a className="row-link nm" title={p.player_name} href={`#/players/${p.player_id}`}>
                    {p.player_name}
                  </a>
                </td>,
                <td key="team">
                  <a className="row-link team-link" title={p.team_name} style={{ color: "var(--muted)" }} href={`#/teams/${p.team_id}`}>{p.team_name}</a>
                </td>,
                <td className="num" key="gp">{p.gp}</td>,
                <td className="num mono" key="min">{n1(p.minutes)}</td>,
                <td className="num" key="ppg">{n1(p.ppg)}</td>,
                <td className="num" key="pts">{p.pts}</td>,
                <td className="num" key="rpg">{n1(p.rpg)}</td>,
                <td className="num" key="apg">{n1(p.apg)}</td>,
                <td className="num" key="spg">{n1(p.spg)}</td>,
                <td className="num" key="bpg">{n1(p.bpg)}</td>,
                <td className="num" key="effpg">{n1(p.effpg)}</td>,
                <td className={`num ${pm === null ? "" : pm >= 0 ? "winner" : "loser"}`} key="pm">
                  {signed(pm)}
                </td>,
                <td className="num" key="fgp">{fgp}</td>,
                <td className="num" key="t3p">{t3p}</td>,
                <td className="num" key="efg">{pctStr(p.efg)}</td>,
                <td className="num" key="ts">{pctStr(p.ts)}</td>,
              ];
            }}
          />
        </div>
      </div>
    </>
  );
}
