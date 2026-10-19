import { useEffect } from "react";
import { api, groupAgeSort } from "../data.js";
import { contextHash, fmtDate, seasonHash, setTitle } from "../utils.js";

/* Landing page: every group of one season, described in a few lines. One payload
 * (season_payload() in server.py → data/season/<id>.json) drives the whole page. */
export default function SeasonView({ ctx, seasonId }) {
  let sp = null;
  let error = null;
  try {
    sp = api("season", { season: seasonId });
  } catch (e) {
    error = e;
  }
  useEffect(() => {
    if (sp) setTitle(sp.season_name);
    else setTitle("No such season");
  }, [sp && sp.season_name, seasonId]);

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

  const t = sp.totals || {};
  const latest = sp.latest_games || [];
  const upcoming = sp.upcoming_games || [];
  const groups = [...(sp.groups || [])].sort(groupAgeSort);

  const row = (g) => (
    <a className="game-row" href={`#/games/${g.event_id}`} key={g.event_id}>
      <div className="gr-top">
        <span className="gr-when">{fmtDate(g.game_date)}</span>
        <span className="gr-group">{g.group_short || ""}</span>
        <span className="final-label">{g.home_score != null ? "FINAL" : "SCHEDULED"}</span>
      </div>
      <div className="gr-match">
        <span className="gr-team home">{g.home_name}</span>
        <strong className="gr-score od-nowrap">
          {g.home_score != null ? g.home_score + " – " + g.away_score : (g.start_time || "vs")}
        </strong>
        <span className="gr-team away">{g.away_name}</span>
      </div>
      <span className="row-arrow" aria-hidden="true">↗</span>
    </a>
  );

  const stats = [
    [t.groups ?? groups.length, "Group"],
    [t.teams ?? 0, "Teams"],
    [t.games ?? 0, "Games"],
    [t.played ?? 0, "Played"],
  ];

  return (
    <>
      <section className="season-hero">
        <div className="hero-copy">
          <p className="eyebrow">THE LEAGUE AT A GLANCE · SEASON {seasonId}</p>
          <h2>
            Every game.
            <br />
            <em>Every rising star.</em>
          </h2>
          <p className="league-title">{sp.season_name}</p>
          <a className="primary-action" href={contextHash("standings", ctx)}>
            Explore standings <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="hero-score">
          <div className="od-row score-caption">
            <span>LATEST FINAL</span>
            <span>{latest[0] ? fmtDate(latest[0].game_date) : "—"}</span>
          </div>
          {latest[0] ? (
            <>
              <a href={`#/games/${latest[0].event_id}`} className="featured-game">
                <span className="od-field">
                  <b>{latest[0].home_name}</b>
                  <strong>{latest[0].home_score}</strong>
                </span>
                <span className="score-divider">:</span>
                <span className="od-field">
                  <b>{latest[0].away_name}</b>
                  <strong>{latest[0].away_score}</strong>
                </span>
              </a>
              <p className="featured-note">{latest[0].group_short || ""} · View game details ↗</p>
            </>
          ) : (
            <p>No completed games yet</p>
          )}
          <div className="court-lines" aria-hidden="true" />
        </div>
      </section>

      <section className="season-stats" aria-label="Season totals">
        {stats.map(([n, label]) => (
          <div className="od-stat" key={label}>
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <div className="dashboard-grid">
        <aside className="results-column">
          <section className="card results">
            <div className="section-head">
              <div>
                <p className="eyebrow">AROUND THE LEAGUE</p>
                <h3>Latest results</h3>
              </div>
              <a href={contextHash("games", ctx)} className="text-link">All games ↗</a>
            </div>
            {latest.map(row) || <p>No games played yet.</p>}
          </section>
          <section className={`upcoming card${upcoming.length ? "" : " upcoming-empty"}`}>
            <div className="section-head">
              <h3>Next on court</h3>
              <span className="small-dot" aria-hidden="true" />
            </div>
            {upcoming.length ? (
              upcoming.map(row)
            ) : (
              <>
                <p>No upcoming games scheduled.</p>
                <span className="muted">The next fixtures will appear here.</span>
              </>
            )}
          </section>
          <div className="source-note">
            <span className="source-mark">HL</span>
            <p>
              Built around the game.
              <br />
              <span>Hillen Youth Girls Basketball League</span>
            </p>
          </div>
        </aside>

        <section className="division-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">FIND YOUR COMPETITION</p>
              <h3>Group</h3>
            </div>
            <span className="count-tag">{groups.length} groups</span>
          </div>
          <div className="grid-cards">
            {groups.map((g) => {
              const age = (g.name.match(/U\d+/) || ["—"])[0];
              const label = g.name.match(/GROUP (.+)/)?.[0] || "YOUTH GIRLS";
              return (
                <a
                  className="card season-card"
                  key={g.group_id}
                  href={`#/standings?season=${seasonId}&group=${g.group_id}`}
                >
                  <div className="od-row division-top">
                    <span className="division-age">{age}</span>
                    <span className="division-group">{label}</span>
                    <span className="division-arrow" aria-hidden="true">↗</span>
                  </div>
                  <h3>{g.name.replace("YOUTH GIRLS ", "").replace(/GROUP /, "Group ")}</h3>
                  <p className="season-size">{g.teams} teams · {g.played} played</p>
                  <div className="division-leader">
                    <span className="leader-label">{g.leader ? "LEADING TEAM" : "SEASON STATUS"}</span>
                    <span className="od-clamp-2">{g.leader ? g.leader.team_name : "Awaiting first tip-off"}</span>
                    {g.leader ? (
                      <span className="leader-record od-nowrap">
                        {g.leader.wins}W · {g.leader.losses}L <b>{g.leader.points} pts</b>
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
