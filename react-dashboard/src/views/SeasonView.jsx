import { useEffect } from "react";
import { api, groupAgeSort, groupName, scopeLabel, seasonGroups } from "../data.js";
import {
  contextHash,
  fmtDate,
  gameStatus,
  hasResult,
  seasonHash,
  setTitle,
  scoreText,
  sortByKickoff,
} from "../utils.js";
import GameStatus from "../components/GameStatus.jsx";
import ScopeEmpty from "../components/ScopeEmpty.jsx";

/* Landing page for one season, scoped to one group (UX-01).
 *
 * The page answers "what is happening in MY group right now": the four totals,
 * the latest results and the next fixtures are all read from
 * the current season/group, not the whole season. The group cards below are
 * navigation — each one switches the whole dashboard to that group, which is
 * why this section is labelled as a directory rather than as season content. */

const shortGroupName = (name) =>
  String(name || "")
    .replace(/^YOUTH GIRLS?\s+/i, "")
    .replace(/GROUP /g, "Group ");

export default function SeasonView({ ctx, seasonId }) {
  const season = +seasonId;
  let sp = null;
  let error = null;
  try {
    sp = api("season", { season });
  } catch (e) {
    error = e;
  }

  /* The URL can name a season the stored context knows nothing about (e.g. a
   * hand-typed #/season/31 while the context is still 33/16); fall back to the
   * first group of *this* season so every label and list agrees. */
  const metaGroups = seasonGroups(season);
  const group = metaGroups.some((g) => g.group_id === ctx.group)
    ? ctx.group
    : metaGroups[0]?.group_id ?? null;
  const gname = group != null ? groupName(season, group) : "";
  const scopeCtx = { season, group: group ?? ctx.group };

  useEffect(() => {
    if (sp) setTitle(gname || sp.season_name, "Season " + season);
    else setTitle("No such season");
  }, [gname, season, sp && sp.season_name]);

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

  /* All per-group reads use the canonical payloads; season_payload()'s
   * `latest_games` / `upcoming_games` are season-wide, so they cannot answer a
   * group-scoped question. */
  let games = [];
  let teams = [];
  if (group != null) {
    try {
      games = api("games", scopeCtx) || [];
      teams = api("teams", scopeCtx) || [];
    } catch (e) {
      games = [];
      teams = [];
    }
  }

  const resolved = games.filter(hasResult);
  const latest = sortByKickoff(resolved, "desc").slice(0, 5);
  /* Unplayed fixtures are skipped (the league does not make them up), so they
   * are not competition games: `competition` keeps Played + Remaining = Games. */
  const competition = games.filter((g) => gameStatus(g).code !== "skipped");
  const upcoming = sortByKickoff(
    games.filter((g) => gameStatus(g).code === "upcoming")
  );

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
        <span className="gr-when">
          {fmtDate(g.game_date)}
          {hasResult(g) || !g.start_time ? "" : ` · ${g.start_time}`}
        </span>
        <GameStatus game={g} className="gr-status" />
      </div>
      <div className="gr-match">
        <span className="gr-team home">{g.home_name}</span>
        <strong className="gr-score od-nowrap">
          {hasResult(g) ? scoreText(g) : "vs"}
        </strong>
        <span className="gr-team away">{g.away_name}</span>
      </div>
      <span className="row-arrow" aria-hidden="true">↗</span>
    </a>
  );

  /* Played = fixtures with a recorded result (final or forfeit), so the strip
   * always adds up: Played + Remaining = Games. */
  const stats = [
    [teams.length, "Teams"],
    [competition.length, "Games"],
    [resolved.length, "Played"],
    [upcoming.length, "Remaining"],
  ];

  const groups = [...(sp.groups || [])].sort(groupAgeSort);

  return (
    <>
      <header className="scope-head">
        <p className="scope-eyebrow">{scopeLabel(season, group)}</p>
        <div className="scope-row">
          <h2 className="scope-title">Group overview</h2>
          <a className="text-link scope-jump" href={contextHash("standings", scopeCtx)}>
            Standings ↗
          </a>
        </div>
        <p className="scope-sub">{sp.season_name}</p>
      </header>

      <section className="season-stats" aria-label="Group totals">
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
                <h3>Latest results</h3>
              </div>
              <a href={contextHash("games", scopeCtx)} className="text-link">All games ↗</a>
            </div>
            {latest.length ? (
              latest.map(row)
            ) : (
              <ScopeEmpty
                title="No completed games yet"
                text="Results appear here after this group's first final."
                href={contextHash("games", scopeCtx)}
                linkLabel="View fixtures ↗"
              />
            )}
          </section>

          <section className={`upcoming card${upcoming.length ? "" : " upcoming-empty"}`}>
            <div className="section-head">
              <h3>Next on court</h3>
              <span className="small-dot" aria-hidden="true" />
            </div>
            {upcoming.length ? (
              upcoming.map(row)
            ) : (
              <p>
                No upcoming fixtures.{" "}
                <a className="scope-inline-link" href={contextHash("games", scopeCtx)}>
                  All games ↗
                </a>
              </p>
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

        <section className="division-section" aria-labelledby="groups-heading">
          <div className="section-head">
            <div>
              <h3 id="groups-heading">All groups in Season {season}</h3>
            </div>
            <span className="count-tag">{groups.length} groups</span>
          </div>
          <p className="scope-note">
            Browse the divisions — opening a group switches the whole dashboard to it. Showing{" "}
            <b>{gname || "this group"}</b>.
          </p>
          <div className="grid-cards">
            {groups.map((g) => {
              const age = (g.name.match(/U\d+/) || ["—"])[0];
              const label = g.name.match(/GROUP (.+)/)?.[0] || "YOUTH GIRLS";
              const gGames = gamesFor(g.group_id);
              const gResolved = gGames.filter(hasResult);
              const current = g.group_id === group;
              const empty = !g.teams;
              const leader = !empty && g.played > 0 ? g.leader : null;
              return (
                <a
                  className={`card season-card${current ? " is-current" : ""}${
                    empty ? " is-empty" : ""
                  }`}
                  key={g.group_id}
                  href={`#/standings?season=${season}&group=${g.group_id}`}
                  aria-current={current ? "true" : undefined}
                >
                  <div className="od-row division-top">
                    <span className="division-age">{age}</span>
                    <span className="division-group">{label}</span>
                    <span className="division-arrow" aria-hidden="true">↗</span>
                  </div>
                  <h3>{shortGroupName(g.name)}</h3>
                  {current ? <span className="scope-tag">Current group</span> : null}
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
