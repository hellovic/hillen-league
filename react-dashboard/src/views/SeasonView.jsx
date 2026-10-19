import { useEffect } from "react";
import { api, groupAgeSort } from "../data.js";
import { fmtDate, hasResult, scoreText, seasonHash, setTitle } from "../utils.js";
import GameStatus from "../components/GameStatus.jsx";

/* Season overview: the whole league at a glance.
 *
 * This page is deliberately NOT bound to the selected group: it answers "what
 * is happening in Season N" across every division. The group cards at the
 * bottom are the drill-down — each one switches the dashboard to that group —
 * and the eyebrow says ALL GROUPS so the scope can never be mistaken for the
 * header's group picker (which only governs the group-scoped pages). */

/* Card heading keeps “Girls” — boys' groups will coexist in the same season. */
const shortGroupName = (name) =>
  String(name || "")
    .replace(/^YOUTH\s+/i, "")
    .replace(/GROUP /g, "Group ")
    .replace(/^GIRLS/i, "Girls");

export default function SeasonView({ ctx, seasonId }) {
  const season = +seasonId;
  let sp = null;
  let error = null;
  try {
    sp = api("season", { season });
  } catch (e) {
    error = e;
  }

  useEffect(() => {
    if (sp) setTitle(sp.season_name, "Season " + season);
    else setTitle("No such season");
  }, [season, sp && sp.season_name]);

  if (error) {
    const seasons = (window.LEAGUE_DATA?.meta?.seasons) || [];
    return (
      <div className="empty">
        No such season. Available:{" "}
        {seasons.map((s, i) => (
          <span key={s.season_id}>
            {i ? " · " : null}
            <a className="row-link" href={seasonHash(s.season_id)}>{s.name}</a>
          </span>
        ))}
      </div>
    );
  }

  const latest = (sp.latest_games || []).slice(0, 5);
  const upcoming = sp.upcoming_games || [];
  const groups = [...(sp.groups || [])].sort(groupAgeSort);

  const gamesFor = (gid) => {
    try {
      return api("games", { season, group: gid }) || [];
    } catch (e) {
      return [];
    }
  };

  const row = (g) => (
    <a className="game-row" href={`#/games/${g.event_id}`} key={g.event_id}>
      <div className="gr-top">
        <span className="gr-when">{fmtDate(g.game_date)}</span>
        {g.group_short ? <span className="gr-group">{g.group_short}</span> : null}
        <GameStatus game={g} className="gr-status" />
      </div>
      <div className="gr-match">
        <span className="gr-team home">{g.home_name}</span>
        <strong className="gr-score od-nowrap">
          {hasResult(g) ? scoreText(g) : g.start_time || "vs"}
        </strong>
        <span className="gr-team away">{g.away_name}</span>
      </div>
      <span className="row-arrow" aria-hidden="true">↗</span>
    </a>
  );

  return (
    <>
      {/* The owner asked for the old season hero + totals strip to be removed
        * (2026-10-19): the header already names the season and says “All groups”,
        * so the page opens straight on the results. */}
      <h2 className="sr-only">{sp.season_name} overview</h2>

      <div className="dashboard-grid">
        <aside className="results-column">
          <section className="card results">
            <div className="section-head">
              <div>
                <h3>Latest results</h3>
              </div>
            </div>
            {latest.length ? (
              latest.map(row)
            ) : (
              <p className="scope-note">No completed games yet in this season.</p>
            )}
          </section>

          <section className={`upcoming card${upcoming.length ? "" : " upcoming-empty"}`}>
            <div className="section-head">
              <h3>Next on court</h3>
              <span className="small-dot" aria-hidden="true" />
            </div>
            {upcoming.length ? (
              upcoming.slice(0, 5).map(row)
            ) : (
              <p>No upcoming games scheduled.</p>
            )}
          </section>
        </aside>

        <section className="division-section" aria-labelledby="groups-heading">
          <div className="section-head">
            <div>
              <h3 id="groups-heading">All groups in Season {season}</h3>
            </div>
            <span className="count-tag">{groups.length} groups</span>
          </div>
          <p className="scope-note">
            Every division in the season — open one to switch the dashboard to it.
          </p>
          <div className="grid-cards">
            {groups.map((g) => {
              const age = (g.name.match(/(GIRLS?\s+)?U\d+/) || ["—"])[0].replace(/^GIRLS?\s+/i, "GIRLS ");
              const label = g.name.match(/GROUP (.+)/)?.[0] || "";
              const gResolved = gamesFor(g.group_id).filter(hasResult);
              const empty = !g.teams;
              const leader = !empty && g.played > 0 ? g.leader : null;
              return (
                <a
                  className={`card season-card${empty ? " is-empty" : ""}`}
                  key={g.group_id}
                  href={`#/standings?season=${season}&group=${g.group_id}`}
                >
                  <div className="od-row division-top">
                    <span className="division-age">{age}</span>
                    {label ? <span className="division-group">{label}</span> : null}
                    <span className="division-arrow" aria-hidden="true">↗</span>
                  </div>
                  <h3>{shortGroupName(g.name)}</h3>
                  <p className="season-size">
                    {`${g.teams} teams · ${gResolved.length} played`}
                  </p>
                  <div className="division-leader">
                    <span className="leader-label">
                      {leader ? "LEADING TEAM" : "GROUP STATUS"}
                    </span>
                    <span className="od-clamp-2">
                      {empty
                        ? "No teams entered yet"
                        : leader
                        ? leader.team_name
                        : "No games played yet"}
                    </span>
                    {leader ? (
                      <span className="leader-record od-nowrap">
                        {leader.wins}W · {leader.losses}L <b>{leader.points} pts</b>
                      </span>
                    ) : null}
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
