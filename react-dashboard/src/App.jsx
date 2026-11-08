import { Component, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_GROUP, DEFAULT_SEASON, meta, seasonGroups, groupName, genderForGroup, seasonsForGender, entityScope, routeDataReady, loadRouteData, playerStory } from "./data.js";
import { contextHash, seasonHash } from "./utils.js";
import { PALETTES, PaletteContext } from "./theme.jsx";
import { trackPageview } from "./analytics.js";
import Topbar from "./components/Topbar.jsx";
import StoryPromo from "./components/StoryPromo.jsx";
import Tabs from "./components/Tabs.jsx";
import MobileNav from "./components/MobileNav.jsx";
import Footer from "./components/Footer.jsx";
import SeasonView from "./views/SeasonView.jsx";
import StandingsView from "./views/StandingsView.jsx";
import TeamsView from "./views/TeamsView.jsx";
import TeamDetail from "./views/TeamDetail.jsx";
import PlayersView from "./views/PlayersView.jsx";
import PlayerDetail from "./views/PlayerDetail.jsx";
import PlayerStory, { StoryDirectory } from "./views/PlayerStory.jsx";
import GamesView from "./views/GamesView.jsx";
import GameDetail from "./views/GameDetail.jsx";
import LeadersView from "./views/LeadersView.jsx";
import CompareView from "./views/CompareView.jsx";

/* Hash router, mirroring route() in the OD app: the fragment is
 * `#/<view>[/<id>[/<id2>]][?season=&group=]`. Context (season + group) lives in
 * React state, so navigating within a view keeps the selection; explicit query
 * params in the URL adopt into that state. */
const LIST_VIEWS = new Set(["standings", "teams", "players", "games", "leaders", "compare"]);
const TAB_FOR = { teams: "teams", players: "players", games: "games", compare: "compare" };

function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query || "");
  return { parts, params };
}

function validGroup(season, group) {
  return seasonGroups(season).some((g) => g.group_id === group);
}

function validSeason(season) {
  return !!season && !!meta.seasons?.some((s) => s.season_id === season);
}

/* `#/season/31` names a season in the path, not in the query, and the header
 * pickers must follow it: otherwise a shared season link renders season 31 while
 * the chip/selects still say 33. */
function routeSeasonId(parts) {
  if (parts[0] !== "season") return null;
  const id = +parts[1];
  return validSeason(id) ? id : null;
}

/* The published app only supports the query form (#/players/15376?season=32&
 * group=31), but the old vanilla dashboard also accepted a positional scope
 * (#/players/15376/32/31) and README documents that compatibility. Parse it so
 * an old shared link opens the same player in the same season+group. */
function routePlayerScope(parts) {
  if (parts[0] !== "players") return null;
  const season = +parts[2];
  const group = +parts[3];
  if (!validSeason(season) || !Number.isFinite(group)) return null;
  return {
    season,
    group: validGroup(season, group) ? group : seasonGroups(season)[0]?.group_id,
  };
}

function resolveCtx(parts, params, prev = {}) {
  const qs = +params.get("season"); const qg = +params.get("group");
  const legacy = routePlayerScope(parts);
  let season = validSeason(qs) ? qs : routeSeasonId(parts) || legacy?.season || prev.season || DEFAULT_SEASON;
  const explicitGroup = validGroup(season,qg) ? qg : legacy?.group;
  let gender = explicitGroup ? genderForGroup(season,explicitGroup) : ["girls","boys"].includes(params.get("gender")) ? params.get("gender") : prev.gender || "girls";
  const entity = !explicitGroup ? entityScope(parts,season,gender,prev.group) : null;
  if (entity) { season=entity.season; gender=genderForGroup(entity.season,entity.group); }
  if (!seasonGroups(season,gender).length && !params.has("gender") && (validSeason(qs) || routeSeasonId(parts))) gender = "girls";
  if (!seasonGroups(season,gender).length) season=seasonsForGender(gender).at(-1)?.season_id || DEFAULT_SEASON;
  const groups=seasonGroups(season,gender);
  const requested=explicitGroup || entity?.group;
  const age=groupName(prev.season,prev.group).match(/U\d+/)?.[0];
  const group=groups.find((g)=>g.group_id===requested)?.group_id ?? groups.find((g)=>g.group_id===prev.group)?.group_id ?? (gender==="girls" && groups.some((g)=>g.group_id===DEFAULT_GROUP) ? DEFAULT_GROUP : groups.find((g)=>g.name.match(/U\d+/)?.[0]===age)?.group_id ?? groups[0]?.group_id);
  return { season,group,gender };
}
function initialCtx() {
  const {parts,params}=parseHash();
  return resolveCtx(parts,params);
}

function initialTheme() {
  const attr = document.documentElement.dataset.theme;
  return attr === "light" ? "light" : "dark";
}

/* Catches a bad entity id (e.g. #/teams/99999) and shows at most the same
 * "Not found" card the vanilla withNotFound() helper produced. */
class ViewBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="view-head">
          <h2>Not found</h2>
          <div className="sub">{this.state.error.message || "No data for that link."}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const [ctx, setCtx] = useState(initialCtx);
  const [theme, setTheme] = useState(initialTheme);

  const [dataVersion, setDataVersion] = useState(0);
  const [dataError, setDataError] = useState(null);
  const dataKey = route.parts.join("/") + "/" + ctx.season + "/" + ctx.group;
  const dataReady = routeDataReady(route.parts, ctx);
  const currentDataError = dataError?.key === dataKey ? dataError.error : null;
  useEffect(() => {
    if (dataReady) return;
    let cancelled = false;
    loadRouteData(route.parts, ctx).then(() => {
      if (!cancelled) setDataVersion((v) => v + 1);
    }).catch((error) => {
      if (!cancelled) setDataError({ key: dataKey, error });
    });
    return () => { cancelled = true; };
  }, [dataKey, dataReady, dataVersion]);

  /* -- routing ---------------------------------------------------------- */
  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      setCtx((prev) => resolveCtx(next.parts, next.params, prev));
      setRoute(next);
      window.scrollTo(0, 0);
    };
    if (!location.hash) history.replaceState(null, "", seasonHash(initialCtx().season, initialCtx().gender));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const adoptContext = useCallback((season, group) => {
    if (!season) return;
    setCtx((prev) => {
      const selected = validGroup(season,group) ? group : seasonGroups(season,prev.gender)[0]?.group_id;
      return { season, group:selected, gender:genderForGroup(season,selected) };
    });
  }, []);

  /* Keep the URL in step with the selectors, exactly like syncUrl(): the season
   * view canonicalises to #/season/<id>. Lists and the career archive carry
   * the header scope in query params. Other detail views own their URL.
   *
   * replaceState() does not fire hashchange, so the route state must be
   * refreshed by hand. Without this the season view keeps rendering the id that
   * was in the URL when it mounted: picking season 31 updates the address bar to
   * #/season/31 and the context, but `parts[1]` (the prop SeasonView renders)
   * stays 33. */
  const syncUrl = useCallback((season, group, gender) => {
    const { parts } = parseHash();
    const view = parts[0] || "season";
    let hash;
    if (view === "season") hash = seasonHash(season,gender);
    else if (view === "player-story") hash = contextHash(parts.join("/"), { season, group, gender });
    else if (LIST_VIEWS.has(view)) hash = contextHash(view, { season, group, gender });
    else return;
    if (location.hash === hash) return;
    history.replaceState(null, "", hash);
    setRoute(parseHash());
  }, []);

  const changeSeason = (season) => {
    const groups = seasonGroups(season,ctx.gender);
    const group = groups.some((g) => g.group_id === ctx.group) ? ctx.group : groups[0]?.group_id;
    setCtx({ season, group, gender:ctx.gender });
    syncUrl(season, group, ctx.gender);
  };
  const changeGroup = (group) => {
    setCtx({ ...ctx, group });
    syncUrl(ctx.season, group, ctx.gender);
  };

  const changeGender = (gender) => {
    if (gender === ctx.gender) return;
    const params = new URLSearchParams({ season:String(ctx.season), gender });
    const next = resolveCtx([], params, {...ctx,group:undefined,gender});
    const current = parseHash().parts;
    const view = current[0] || "season";
    setCtx(next);
    if (view === "player-story") {
      syncUrl(next.season, next.group, next.gender);
      return;
    }
    const isList = LIST_VIEWS.has(view) && !(+current[1]);
    const hash = isList ? contextHash(view,next) : seasonHash(next.season,gender);
    history.replaceState(null,"",hash);
    setRoute(parseHash());
    window.scrollTo(0,0);
  };

  /* -- theme ------------------------------------------------------------ */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setMetaThemeColor(theme);
    try {
      localStorage.setItem("courtside-theme", theme);
    } catch (e) {
      /* private mode — theme still applies for this visit */
    }
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  /* -- view dispatch ---------------------------------------------------- */
  const parts = route.parts;
  const view = parts[0] || "season";
  const id = +parts[1] || null;
  const id2 = +parts[2] || null;
  const active = TAB_FOR[view] || view;
  const viewKey = view === "player-story" ? parts.join("/") : dataKey;

  // After the visible page is painted, prepare only the selected group's
  // player list. This keeps a first Players/Compare visit responsive without
  // downloading every group's full statistics at startup.
  useEffect(() => {
    if (!dataReady || navigator.connection?.saveData ||
        !["season", "standings", "teams", "games", "leaders"].includes(view) ||
        routeDataReady(["players"], ctx)) return;
    let secondFrame, idle;
    const warm = () => { loadRouteData(["players"], ctx).catch(() => {}); };
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        idle = window.requestIdleCallback
          ? window.requestIdleCallback(warm, { timeout: 1500 })
          : setTimeout(warm, 150);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [view, ctx.season, ctx.group, dataReady]);


  const content = (() => {
    if (currentDataError) return <div className="empty" role="alert">{currentDataError.message} <button type="button" onClick={() => { setDataError(null); setDataVersion((v) => v + 1); }}>Retry</button></div>;
    if (!dataReady) return <div className="empty" role="status">Loading league data…</div>;
    switch (view) {
      case "teams":
        return id ? <TeamDetail ctx={ctx} id={id} onAdoptContext={adoptContext} /> : <TeamsView ctx={ctx} />;
      case "players":
        return id ? <PlayerDetail ctx={ctx} id={id} /> : <PlayersView ctx={ctx} />;
      case "player-story":
        return parts[1] ? <PlayerStory story={playerStory(id)} ctx={ctx} /> : <StoryDirectory gender={ctx.gender} />;
      case "games":
        return id ? <GameDetail ctx={ctx} id={id} onAdoptContext={adoptContext} /> : <GamesView ctx={ctx} />;
      case "compare":
        return <CompareView ctx={ctx} type={parts[1]} a={+parts[2] || null} b={+parts[3] || null} />;
      case "standings":
        return <StandingsView ctx={ctx} />;
      case "leaders":
        return <LeadersView ctx={ctx} />;
      case "season":
        return <SeasonView ctx={ctx} seasonId={id || ctx.season} />;
      default:
        return <StandingsView ctx={ctx} />;
    }
  })();

  /* Expose the rendered route for headless checks (scripts/verify.mjs) and
   * report it to PostHog (see src/analytics.js). */
  useEffect(() => {
    if (!dataReady && !currentDataError) {
      document.documentElement.dataset.route = "";
      return;
    }
    document.documentElement.dataset.route = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    trackPageview();
  }, [route, ctx, dataReady, currentDataError]);

  const palette = useMemo(() => PALETTES[theme], [theme]);

  return (
    <PaletteContext.Provider value={palette}>
      <div className="site-layout">
        <div className="league-header">
          <Topbar
            ctx={ctx}
            theme={theme}
            onGenderChange={changeGender}
            allGroups={view === "season"}
            onToggleTheme={toggleTheme}
            onSeasonChange={changeSeason}
            onGroupChange={changeGroup}
            onAdoptContext={adoptContext}
          />
          <StoryPromo key={parts.join("/")} currentPlayerId={view === "player-story" ? id : null} />
        </div>
        <Tabs active={active} ctx={ctx} />
        <main id="view">
          <ViewBoundary key={viewKey}>
            {content}
          </ViewBoundary>
        </main>
        <Footer gender={ctx.gender} />
      </div>
      <MobileNav active={active} ctx={ctx} />
    </PaletteContext.Provider>
  );
}

function setMetaThemeColor(theme) {
  const el = document.querySelector('meta[name="theme-color"]');
  if (el) el.setAttribute("content", theme === "light" ? "#f6f7f9" : "#101112");
}
