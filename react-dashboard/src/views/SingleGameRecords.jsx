import { useEffect, useState } from "react";
import { api, loadRouteData } from "../data.js";
import { useLocale } from "../locale.jsx";
import { fmtDate, go, setTitle, sortByKickoff } from "../utils.js";

const METRICS = [
  { category: "mvp", key: "eff", label: "MVP", heading: "Efficiency in one game" },
  { category: "pts", key: "pts", label: "Points", heading: "Points in one game" },
  { category: "ast", key: "ast", label: "Assists", heading: "Assists in one game" },
  { category: "reb", key: "tot_reb", label: "Rebounds", heading: "Rebounds in one game" },
  { category: "fg3", key: "fg3m", label: "3-pointers", heading: "3-pointers made in one game" },
  { category: "blk", key: "blk", label: "Blocks", heading: "Blocks in one game" },
  { category: "ft", key: "ftm", label: "Free throws", heading: "Free throws made in one game" },
  { category: "stl", key: "stl", label: "Steals", heading: "Steals in one game" },
];

export const LEADER_ORDER = METRICS.map(({ category }) => category);

function rankedRecords(games, key) {
  const best = new Map();
  for (const game of games) {
    for (const player of game.box || []) {
      const value = player[key];
      if (!/[1-9]/.test(player.minutes || "") || !Number.isFinite(value) || value <= 0) continue;
      if ((best.get(player.player_id)?.value ?? 0) >= value) continue;
      best.set(player.player_id, {
        player,
        game,
        value,
        team: player.team_id === game.home_team_id ? game.home_name : game.away_name,
      });
    }
  }
  const sorted = [...best.values()].sort((a, b) => b.value - a.value ||
    a.player.player_name.localeCompare(b.player.player_name, "zh-Hant") ||
    a.player.player_id - b.player.player_id);
  let rank = 0;
  return sorted.flatMap((entry, index) => {
    if (entry.value !== sorted[index - 1]?.value) rank = index + 1;
    return rank <= 10 ? [{ ...entry, rank }] : [];
  });
}

export default function SingleGameRecords({ ctx, switcher, categoryNames }) {
  const { t: tr, scope } = useLocale();
  const [metric, setMetric] = useState(METRICS[0]);
  const [games, setGames] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { season, group } = ctx;

  useEffect(() => {
    setTitle(scope(season, group), tr("Single-game records"));
  }, [season, group, scope, tr]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const groupCtx = { season, group };
      const played = sortByKickoff(api("games", groupCtx).filter((game) => game.status === "completed"), "desc");
      await Promise.all(played.map((game) => loadRouteData(["games", game.event_id], groupCtx)));
      if (!cancelled) setGames(played.map((game) => api("games/" + game.event_id, groupCtx)));
    };
    load().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [season, group, attempt]);

  const records = games ? rankedRecords(games, metric.key) : [];
  return (
    <div className="leaders-view single-game-records">
      <div className="view-head">
        <div className="view-head-copy">
          <p className="eyebrow">{scope(season, group)}</p>
          <h2>{tr("Leaders")}</h2>
        </div>
      </div>
      {switcher}
      <nav className="leader-jump" aria-label={tr("Leaderboard categories")}>
        <div className="leader-jump-strip" role="group" aria-label={tr("Record category")}>
          {METRICS.map((item) => {
            const label = categoryNames.get(item.category) || tr(item.label);
            const code = item.category.toUpperCase();
            const current = metric === item;
            return (
              <button key={item.category} type="button" data-category={item.category}
                className={`leader-chip${current ? " is-current" : ""}`}
                aria-pressed={current} onClick={() => setMetric(item)}>
                {current && <span className="leader-chip-check" aria-hidden="true">✓</span>}
                <span className="leader-chip-cn">{label}</span>
                {label.toUpperCase() !== code && <span className="leader-chip-en">{code}</span>}
              </button>
            );
          })}
        </div>
      </nav>
      <section className="card leaderboard-card">
        <h3>{tr(metric.heading)}</h3>
        {failed ? (
          <div role="alert">{tr("Could not load single-game records.")}{" "}
            <button type="button" className="csv-btn" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>{tr("Retry")}</button>
          </div>
        ) : !games ? <p role="status">{tr("Loading league data…")}</p>
          : !records.length ? <p className="muted">{tr("No records in this category yet.")}</p>
          : (
            <table className="data leaderboard-table records-table">
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">{tr("Player")}</th>
                  <th scope="col">{tr("Team")}</th>
                  <th scope="col">{tr("Date")}</th>
                  <th scope="col" className="num">
                    {metric.category === "mvp" ? "EFF" : metric.category.toUpperCase()}
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map(({ player, game, value, rank, team }) => {
                  const href = `#/games/${game.event_id}`;
                  return (
                    <tr key={player.player_id} data-href={href}
                      onClick={(event) => {
                        if (!event.target.closest("a")) go(href);
                      }}>
                      <td className="num">{rank}</td>
                      <td><a className="row-link" href={href}>{player.player_name}</a></td>
                      <td className="muted">{team}</td>
                      <td>{fmtDate(game.game_date)}</td>
                      <td className="num">{value}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </section>
    </div>
  );
}
