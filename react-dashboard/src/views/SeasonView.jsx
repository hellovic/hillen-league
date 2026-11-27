import { useLocale } from "../locale.jsx";
import { useEffect } from "react";
import { api, groupAgeSort, groupGender } from "../data.js";
import { fmtDate, hasResult, scoreText, seasonHash, setTitle, sortByKickoff } from "../utils.js";
import GameStatus from "../components/GameStatus.jsx";
import WeekendFixtures from "../components/WeekendFixtures.jsx";

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
    .replace(/^GIRLS?/i, "Girls")
    .replace(/^BOYS?/i, "Boys");

export default function SeasonView({ ctx, seasonId }) {
  const { t: tr, group, language } = useLocale();
  const season = +seasonId;
  let sp = null;
  let error = null;
  try {
    const all = api("season", { season });
    const groups = all.groups.filter((g) => groupGender(g.name) === ctx.gender);
    const games = groups.flatMap((g) => {
      const name = shortGroupName(g.name).replace(/ Group /i, " ");
      const groupShort = ctx.gender === "boys" && !/^Boys\b/.test(name) ? `Boys ${name}` : name;
      return (api("games", { season, group: g.group_id }) || []).map((game) => ({
        ...game,
        group_id: g.group_id,
        group_name: g.name,
        group_short: groupShort,
      }));
    });
    sp = {
      ...all,
      groups,
      latest_games: sortByKickoff(games.filter(hasResult), "desc").slice(0, 8),
      upcoming_games: sortByKickoff(games.filter((game) => game.status === "scheduled")),
    };
  } catch (e) {
    error = e;
  }

  useEffect(() => {
    if (sp) setTitle(sp.season_name, tr("Season {season}", { season }));
    else setTitle(tr("No such season"));
  }, [season, sp && sp.season_name, tr]);

  if (error) {
    const seasons = (window.LEAGUE_DATA?.meta?.seasons) || [];
    return (
      <div className="empty">{tr("No such season. Available:")}{" "}
        {seasons.map((s, i) => (
          <span key={s.season_id}>
            {i ? " · " : null}
            <a className="row-link" href={seasonHash(s.season_id,ctx.gender)}>{s.name}</a>
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

  const resultRow = (g) => {
    const detail = [g.start_time, g.venue].filter(Boolean).join(" · ");
    return (
      <a className="game-row" href={`#/games/${g.event_id}`} key={g.event_id}>
        <div className="gr-top">
          <span className="gr-when">{fmtDate(g.game_date)}</span>
          {g.group_short ? <span className="gr-group">{language === "zh-Hant" ? group(g.group_name) : g.group_short}</span> : null}
          <GameStatus game={g} className="gr-status" />
        </div>
        <div className="gr-match">
          <span className="gr-team home">{g.home_name}</span>
          <strong className="gr-score od-nowrap">
            {scoreText(g)}
          </strong>
          <span className="gr-team away">{g.away_name}</span>
        </div>
        {/* After the arrow in the DOM so the detail takes its own full-width row
          * instead of pushing the arrow onto a fourth grid row. */}
        <span className="row-arrow" aria-hidden="true">↗</span>
        {detail ? <span className="gr-venue">{detail}</span> : null}
      </a>
    );
  };

  return (
    <>
      {/* The owner asked for the old season hero + totals strip to be removed
        * (2026-10-19): the header already names the season and says “All groups”,
        * so the page opens straight on the results. */}
      <h2 className="sr-only">{tr("{season} overview", { season: sp.season_name })}</h2>

      <div className="dashboard-grid">
        <aside className="results-column">
          <WeekendFixtures key={`${season}/${ctx.gender}`} games={upcoming} />
          <section className="card results">
            <div className="section-head">
              <div>
                <h3>{tr("Latest results")}</h3>
              </div>
            </div>
            {latest.length ? (
              latest.map(resultRow)
            ) : (
              <p className="scope-note">{tr("No completed games yet in this season.")}</p>
            )}
          </section>
        </aside>

        {/* No section heading: the group cards are self-describing (each names
          * its division) and the owner asked for the duplicate label to go. */}
        <section className="division-section" aria-label={tr("{gender} groups in Season {season}", { gender: tr(ctx.gender === "boys" ? "Boys" : "Girls"), season })}>
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
                    <span className="division-age">{group(age)}</span>
                    {label ? <span className="division-group">{group(label)}</span> : null}
                    <span className="division-arrow" aria-hidden="true">↗</span>
                  </div>
                  <h3>{group(shortGroupName(g.name))}</h3>
                  <p className="season-size">
                    {tr("{teams} teams · {games} played", { teams: g.teams, games: gResolved.length })}
                  </p>
                  <div className="division-leader">
                    <span className="leader-label">
                      {tr(leader ? "LEADING TEAM" : "GROUP STATUS")}
                    </span>
                    <span className="od-clamp-2">
                      {empty
                        ? tr("No teams entered yet")
                        : leader
                        ? leader.team_name
                        : tr("No games played yet")}
                    </span>
                    {leader ? (
                      <span className="leader-record od-nowrap">
                        {tr("{wins}W · {losses}L", leader)} <b>{tr("{points} pts", leader)}</b>
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
