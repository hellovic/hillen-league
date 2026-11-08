import { useLocale, useT } from "../locale.jsx";
import { useEffect, useRef, useState } from "react";
import { api, groupName, loadRouteData, routeDataReady, storyCatalog } from "../data.js";
import { contextHash, contextQuery, copyText, n1, pct1, resultOf, setTitle, signed } from "../utils.js";
import StoryJersey from "../components/StoryJersey.jsx";
import StoryPoster from "./StoryPoster.jsx";
import "../styles/player-story.css";

const RECORDS = [["eff", "EFF"], ["pts", "PTS", "Highest scoring game"], ["tot_reb", "REB", "Rebound high"],
  ["ast", "AST", "Assist high"], ["stl", "STL", "Steal high"], ["blk", "BLK", "Block high"]];
const ARCHIVE_NOTE = "Recorded Hillen League games only.";
const STORY_PAGE_SIZE = 24;
const storyHref = (id) => `#/player-story/${id}`;
const searchKey = (value) => value.normalize("NFKC").trim().toLowerCase();
const gameCount = (tr, count) => tr(count === 1 ? "{count} game" : "{count} games", { count });
const seasonRange = (tr, scope) => scope.length === 1
  ? tr("Season {season}", { season: scope[0] })
  : tr("Seasons {first}–{last}", { first: scope[0], last: scope.at(-1) });
const shooting = (made, attempts) => made == null || attempts == null ? "—" : `${made}/${attempts}`;

const ICONS = {
  share: <><path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" /></>,
  link: <><path d="m10 14 4-4m-6 6-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m5-1 1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0" /></>,
  profile: <><circle cx="12" cy="8" r="3" /><path d="M5 20v-1a7 7 0 0 1 14 0v1z" /></>,
};

function Icon({ name }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

function statsHref(story, ctx) {
  const p = story?.profile;
  return p ? `#/players/${p.id}${contextQuery(p)}` : contextHash("players", ctx);
}

export function StoryDirectory({ gender }) {
  const tr = useT();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(STORY_PAGE_SIZE);
  useEffect(() => { setTitle(tr("Player Story")); }, [tr]);
  const search = searchKey(query);
  const results = storyCatalog(gender).filter((entry) => searchKey(entry.name).includes(search));
  const division = tr(gender === "boys" ? "Boys" : "Girls");
  return (
    <div className="story-page story-directory">
      <div className="story-directory-search">
        <SectionTitle title={tr("{division} Player Stories", { division })} tag={tr("{count} stories", { count: results.length.toLocaleString() })} />
        <input id="story-search" type="search" value={query} placeholder={tr("Search by player name")} aria-label={tr("Search by player name")}
          onChange={(event) => { setQuery(event.target.value); setLimit(STORY_PAGE_SIZE); }} />
      </div>
      {results.length === 0 && <p className="story-muted">{tr("No player stories found.")}</p>}
      <ul className="story-directory-list">
        {results.slice(0, limit).map((entry) => (
          <li key={entry.id}>
            <a className="story-card story-directory-link" href={storyHref(entry.id)}>
              <TeamMark name={entry.name} />
              <span><strong>{entry.name}</strong><small>{entry.team}</small></span>
              <span className="story-directory-count">{gameCount(tr, entry.games)} <span aria-hidden="true">›</span></span>
            </a>
          </li>
        ))}
      </ul>
      {results.length > limit && <button type="button" className="story-button" onClick={() => setLimit(limit + STORY_PAGE_SIZE)}>{tr("Show more stories")}</button>}
    </div>
  );
}

function SectionTitle({ title, tag, id }) {
  const tr = useT();
  return <div className="story-section-title"><h2 id={id}>{tr(title)}</h2>{tag && <span>{tr(tag)}</span>}</div>;
}

function Metrics({ items, className = "" }) {
  const tr = useT();
  return <dl className={`story-metrics ${className}`}>
    {items.map(([label, value]) => <div key={label}><dt>{tr(label)}</dt><dd>{value ?? "—"}</dd></div>)}
  </dl>;
}

function Profile({ story }) {
  const tr = useT();
  const { seasons, teams, games, points } = story.totals;
  return (
    <section className="story-card story-hero" aria-labelledby="story-player-name">
      <div className="story-hero-banner">
        <span className="story-kicker"><span aria-hidden="true">●</span> {tr("Recorded journey")} · {seasonRange(tr, story.scope)}</span>
        <span className="story-label">{tr("Career file")}</span>
      </div>
      <div className="story-identity">
        <StoryJersey name={story.name} number={story.jersey} />
        <div>
          <h2 id="story-player-name">{story.name}</h2>
          <p className="story-muted">{story.team}</p>
          {story.ids.length > 1 && (
            <details className="story-identity-note">
              <summary>{tr(story.ids.length === 2 ? "Dual-ID archival sync" : "Multi-ID archival sync")}</summary>
              <p>{tr("Matched {count} league IDs by normalized name. Shared names can refer to different players.", { count: story.ids.length })}</p>
            </details>
          )}
          {story.identity_conflict && <p className="story-note">{tr("Same-name IDs appear on opposing teams in a recorded game. Their stories are shown separately.")}</p>}
        </div>
      </div>
      <p className="story-coverage"><span aria-hidden="true">▤</span> {tr(ARCHIVE_NOTE)}</p>
      <Metrics className="story-career-metrics" items={[["Seasons", seasons], ["Teams", teams], ["Games", games], ["Points", points]]} />
    </section>
  );
}

function TeamMark({ name }) {
  const mark = name.trim().split(/\s+/).map((word) => Array.from(word)[0]).slice(0, 2).join("");
  return <span className="story-team-mark" aria-hidden="true">{mark.toUpperCase() || "HL"}</span>;
}

function Squads({ chapters }) {
  const { t: tr, group } = useLocale();
  const parallel = chapters.some((chapter) => chapter.teams.length > 1);
  return (
    <section className="story-card story-squads" aria-labelledby="story-squads-title">
      <SectionTitle id="story-squads-title" title={tr("Teams & Squads")} tag={parallel ? "Parallel rosters" : "Team archive"} />
      <p className="story-muted">{tr(parallel ? "School and club squads can appear side by side in the same season." : "Squads associated with this player's recorded seasons.")}</p>
      {chapters.map((chapter) => (
        <div key={chapter.season} className="story-squad-season">
          <div className="story-meta-row"><h3>{tr("Season {season}", chapter)}</h3><span className="story-tag">{tr(chapter.teams.length === 1 ? "{count} squad this season" : "{count} squads this season", { count: chapter.teams.length })}</span></div>
          <div className="story-squad-grid">
            {chapter.teams.map((team) => (
              <a className="story-squad" key={team.id} href={`#/teams/${team.id}?season=${chapter.season}&group=${team.group}`}>
                <TeamMark name={team.name} />
                <span><strong>{team.name}</strong><small>{group(groupName(chapter.season, team.group))}{team.gp === 0 ? ` · ${tr("Roster only")}` : ""}</small></span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function GameHeadline({ game, badge }) {
  const tr = useT();
  const home = game.home_team_id === game.team_id;
  const own = home ? game.home_name : game.away_name;
  const opponent = home ? game.away_name : game.home_name;
  const score = home ? game.home_score : game.away_score;
  const otherScore = home ? game.away_score : game.home_score;
  const scored = score != null && otherScore != null;
  const result = scored ? resultOf(game, game.team_id) : null;
  return (
    <>
      <div className="story-match">
        <h3><a href={`#/games/${game.event_id}`}>
          {own} {scored
            ? <b><span className={score > otherScore ? "story-winning-score" : undefined}>{score}</span>–<span className={otherScore > score ? "story-winning-score" : undefined}>{otherScore}</span></b>
            : tr("vs")} {opponent}
        </a></h3>
        {badge || (result && <span className={`story-tag story-result ${result.cls}`}>{tr(({ W: "Win", L: "Loss", T: "Tie" })[result.text[0]])}</span>)}
      </div>
      <p className="story-muted">{tr("Season {season}", { season: game.season_id })}{game.venue && ` · ${game.venue}`}</p>
    </>
  );
}

function Moment({ title, caveat, game, metrics, showEff = false }) {
  const tr = useT();
  return (
    <article className="story-card story-moment">
      <div className="story-meta-row"><span className="story-tag story-tag-accent">{tr(title)}</span><time dateTime={game.game_date || undefined}>{game.game_date || tr("Date unavailable")}</time></div>
      <GameHeadline game={game} badge={showEff && game.eff != null ? <span className="story-tag story-tag-accent">EFF {signed(game.eff)}</span> : null} />
      <Metrics items={metrics} />
      <div className="story-moment-foot"><span>{tr(caveat)}</span><span>{tr("{minutes} played", game)}</span></div>
    </article>
  );
}

function ShotMix({ game }) {
  const tr = useT();
  const shots = [["2PT", game.fg2m, game.fg2a], ["3PT", game.fg3m, game.fg3a], ["FT", game.ftm, game.fta]];
  return (
    <div className="story-shot-mix">
      <h4>{tr("Shot mix")}</h4>
      <svg viewBox="0 0 120 64" aria-hidden="true"><path d="M2 2h116v60H2zM60 2v60M2 17h24v30H2m116-30H94v30h24" /><circle cx="60" cy="32" r="13" /><path d="M2 6a31 31 0 0 1 0 52M118 6a31 31 0 0 0 0 52" /></svg>
      <ul>
        {shots.map(([label, made, attempts]) => <li key={label}><span>{label}</span><span>{shooting(made, attempts)}</span></li>)}
      </ul>
    </div>
  );
}

function Masterclass({ game }) {
  const tr = useT();
  const doubleDouble = [game.pts, game.tot_reb, game.ast, game.stl, game.blk].filter((value) => value >= 10).length >= 2;
  return (
    <article className="story-card story-moment story-masterclass">
      <div className="story-meta-row"><span className="story-tag story-tag-cyan">{tr("Masterclass · Best EFF")}</span><time dateTime={game.game_date || undefined}>{game.game_date || tr("Date unavailable")}</time></div>
      <GameHeadline game={game} badge={<span className="story-tag story-tag-accent">EFF {signed(game.eff)}</span>} />
      <div className="story-masterclass-grid">
        <ShotMix game={game} />
        <Metrics items={[["Points", game.pts], ["Rebounds", game.tot_reb], ["Blocks", game.blk], ["Steals", game.stl]]} />
      </div>
      <div className="story-moment-foot"><span>{tr("Best in collected games")}</span>{doubleDouble && <strong>{tr("Double-double")}</strong>}</div>
    </article>
  );
}

function Moments({ first, best }) {
  const tr = useT();
  const [metric, setMetric] = useState(() => RECORDS.find(([key]) => best[key])?.[0] || "pts");
  const [key, label, title] = RECORDS.find(([key]) => key === metric);
  const record = best[key];
  return (
    <section className="story-moments" aria-labelledby="story-moments-title">
      <SectionTitle id="story-moments-title" title={tr("Memorable Moments")} tag="Archived feats" />
      {!first ? <div className="story-card story-muted">{tr("No completed appearances with recorded playing time.")}</div> : (
        <>
          <div className="story-records" role="group" aria-label={tr("Personal bests in collected games")}>
            {RECORDS.filter(([key]) => best[key]).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>
                {tr("{stat} high", { stat: label })} <b>{key === "eff" ? signed(best[key][key]) : best[key][key]}</b> <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
          <Moment title={tr("First recorded game")} caveat="First recorded appearance" game={first}
            metrics={[["PTS", first.pts], ["REB", first.tot_reb], ["STL", first.stl]]} />
          {key !== "eff" && record && <Moment title={title} caveat="Best in collected games" game={record} showEff
            metrics={key === "pts"
              ? [["PTS", record.pts], ["REB", record.tot_reb], ["AST", record.ast], ["FG%", pct1(record.fga && record.fgm != null ? record.fgm / record.fga * 100 : null)]]
              : [[label, record[key]], ["PTS", record.pts], ["EFF", record.eff]]} />}
          {best.eff && <Masterclass game={best.eff} />}
        </>
      )}
    </section>
  );
}

function BoxScore({ appearance }) {
  const tr = useT();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState(null);
  const parts = ["games", appearance.event_id];
  const ready = routeDataReady(parts, {});
  useEffect(() => {
    if (ready) return;
    let active = true;
    loadRouteData(parts, {}).then(() => {
      if (active) setStatus("loaded");
    }, () => {
      if (active) setStatus("error");
    });
    return () => { active = false; };
  }, [ready, attempt, appearance.event_id]);

  if (!ready) return status === "error"
    ? <div className="story-box" role="alert">{tr("Could not load box score.")} <button type="button" onClick={() => { setStatus(null); setAttempt(attempt + 1); }}>{tr("Retry")}</button></div>
    : <div className="story-box" role="status">{tr("Loading box score…")}</div>;

  const game = api(`games/${appearance.event_id}`);
  const row = game.box.find((item) => item.player_id === appearance.player_id && item.team_id === appearance.team_id);
  return (
    <div className="story-box">
      {row ? <Metrics items={[
        ["MIN", row.minutes], ["PTS", row.pts], ["2PT", shooting(row.fg2m, row.fg2a)], ["3PT", shooting(row.fg3m, row.fg3a)],
        ["FG", shooting(row.fgm, row.fga)], ["FT", shooting(row.ftm, row.fta)], ["OREB", row.off_reb], ["DREB", row.def_reb],
        ["REB", row.tot_reb], ["AST", row.ast], ["STL", row.stl], ["BLK", row.blk], ["TO", row.tov], ["PF", row.pf],
        ["EFF", row.eff], ["+/−", signed(row.plus_minus)],
      ]} /> : <span className="story-muted">{tr("Individual box score unavailable.")}</span>}
      <a href={`#/games/${appearance.event_id}`}>{tr("Open full game box score")} <span aria-hidden="true">↗</span></a>
    </div>
  );
}

function GameLogRow({ appearance }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <details className="story-game-row" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span><small>{appearance.date || tr("Date unavailable")}</small><strong>{tr("vs")} {appearance.opponent}</strong></span>
        <span className="story-game-stat">{appearance.pts ?? "—"} PTS · {signed(appearance.eff)} EFF</span>
      </summary>
      {open && <BoxScore appearance={appearance} />}
    </details>
  );
}

function SeasonLog({ chapter }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <details className="story-log" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span><strong>{tr("Season {season} Game Log", chapter)}</strong><small>{tr("Expand for game-by-game box scores and EFF")}</small></span>
        <span className="story-tag">{gameCount(tr, chapter.games.length)}</span>
      </summary>
      {open && <div className="story-log-rows">{chapter.games.map((appearance) => <GameLogRow key={appearance.event_id} appearance={appearance} />)}</div>}
    </details>
  );
}

function ScoringTrajectory({ chapters }) {
  const tr = useT();
  const played = chapters.filter((chapter) => chapter.games.length);
  if (played.length < 2) return null;
  const rates = played.map((chapter) => chapter.pts / chapter.games.length);
  const delta = Math.round((rates.at(-1) - rates[0]) * 10) / 10;
  return (
    <div className="story-card story-trajectory">
      <div className="story-meta-row"><h3>{tr("Scoring trajectory")}</h3><span className="story-tag story-tag-accent">{signed(delta)} PPG</span></div>
      <ul>
        {played.map((chapter, index) => <li key={chapter.season}>
          <span>{tr("Season {season}", chapter)}</span>
          <span className="story-bar" aria-hidden="true"><i style={{ width: `${rates[index] / Math.max(1, ...rates) * 100}%` }} /></span>
          <strong>{n1(rates[index])} PPG</strong>
        </li>)}
      </ul>
    </div>
  );
}

function Chronicles({ chapters }) {
  const tr = useT();
  return (
    <section className="story-chronicles" aria-labelledby="story-chronicles-title">
      <SectionTitle id="story-chronicles-title" title={tr("Season Chronicles")} tag="Chronological log" />
      {chapters.map((chapter, index) => (
        <article className="story-card story-chapter" key={chapter.season}>
          <div className="story-chapter-head">
            <span className="story-chapter-number">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{tr("Season {season}", chapter)}</h3><span className="story-muted">{tr(chapter.games.length ? "Recorded appearances" : "Roster record")}</span></div>
            <span className="story-tag">{gameCount(tr, chapter.games.length)}</span>
          </div>
          {chapter.teams.map((team) => (
            <div className="story-team-production" key={team.id}>
              <div><strong>{team.name}</strong><small>{team.gp ? tr("{games} logged", { games: gameCount(tr, team.gp) }) : tr("Official roster · 0 recorded appearances")}</small></div>
              {team.gp > 0 && <div className="story-ppg"><strong>{n1(team.pts / team.gp)}</strong><small>PPG</small></div>}
            </div>
          ))}
          {chapter.games.length > 0 && <SeasonLog chapter={chapter} />}
        </article>
      ))}
      <ScoringTrajectory chapters={chapters} />
    </section>
  );
}

function StoryActions({ story, ctx, posterRef }) {
  const tr = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => copyText(new URL(storyHref(story.id), location.href).href, () => setCopied(true));
  return (
    <div className="story-actions">
      <button type="button" className="story-button story-primary" onClick={() => posterRef.current?.showModal()}><Icon name="share" /> {tr("Share Story Poster")}</button>
      <div>
        <button type="button" className="story-button" onClick={copy}><Icon name="link" /> {tr(copied ? "Story link copied" : "Copy Story Link")}</button>
        <a className="story-button" href={statsHref(story, ctx)}><Icon name="profile" /> {tr("League Stats")}</a>
      </div>
    </div>
  );
}

export default function PlayerStory({ story, ctx }) {
  const tr = useT();
  const posterRef = useRef(null);
  useEffect(() => { setTitle(story?.name || tr("Story not found"), tr("Player Story")); }, [story, tr]);
  if (!story) return <div className="story-page story-card"><h2>{tr("Story not found")}</h2><a href="#/player-story">{tr("Browse player stories")}</a></div>;
  return (
    <div className="story-page">
      <div className="story-toolbar">
        <a className="story-back" href="#/player-story">{tr("← All Player Stories")}</a>
        <button type="button" className="story-button" aria-label={tr("Share story poster")} onClick={() => posterRef.current?.showModal()}><Icon name="share" /></button>
        <a className="story-button" href={statsHref(story, ctx)} aria-label={tr("League stats")}><Icon name="profile" /></a>
      </div>
      <div className="story-layout">
        <div className="story-intro">
          <Profile story={story} />
          <Squads chapters={story.chapters} />
        </div>
        <Moments first={story.first} best={story.best} />
        <Chronicles chapters={story.chapters} />
        <StoryActions story={story} ctx={ctx} posterRef={posterRef} />
      </div>
      <StoryPoster story={story} posterRef={posterRef} archiveNote={ARCHIVE_NOTE} />
    </div>
  );
}
