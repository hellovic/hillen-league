import { Component, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_GROUP, DEFAULT_SEASON, meta, seasonGroups } from "./data.js";
import { contextHash, seasonHash } from "./utils.js";
import { PALETTES, PaletteContext } from "./theme.jsx";
import { trackPageview } from "./analytics.js";
import Topbar from "./components/Topbar.jsx";
import Tabs from "./components/Tabs.jsx";
import MobileNav from "./components/MobileNav.jsx";
import Footer from "./components/Footer.jsx";
import SeasonView from "./views/SeasonView.jsx";
import StandingsView from "./views/StandingsView.jsx";
import TeamsView from "./views/TeamsView.jsx";
import TeamDetail from "./views/TeamDetail.jsx";
import PlayersView from "./views/PlayersView.jsx";
import PlayerDetail from "./views/PlayerDetail.jsx";
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

function initialCtx() {
  const { params } = parseHash();
  const qSeason = +params.get("season");
  const qGroup = +params.get("group");
  const season = meta.seasons?.some((s) => s.season_id === qSeason) ? qSeason : DEFAULT_SEASON;
  const group = validGroup(season, qGroup)
    ? qGroup
    : validGroup(season, DEFAULT_GROUP)
      ? DEFAULT_GROUP
      : seasonGroups(season)[0]?.group_id;
  return { season, group };
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

  /* -- routing ---------------------------------------------------------- */
  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      const qSeason = +next.params.get("season");
      const qGroup = +next.params.get("group");
      if (meta.seasons?.some((s) => s.season_id === qSeason)) {
        setCtx((prev) => ({
          season: qSeason,
          group: validGroup(qSeason, qGroup) ? qGroup : validGroup(qSeason, prev.group) ? prev.group : seasonGroups(qSeason)[0]?.group_id,
        }));
      }
      setRoute(next);
      window.scrollTo(0, 0);
    };
    if (!location.hash) history.replaceState(null, "", seasonHash(initialCtx().season));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const adoptContext = useCallback((season, group) => {
    if (!season) return;
    setCtx((prev) => ({
      season,
      group: validGroup(season, group)
        ? group
        : validGroup(season, prev.group)
          ? prev.group
          : seasonGroups(season)[0]?.group_id,
    }));
  }, []);

  /* Keep the URL in step with the selectors, exactly like syncUrl(): the season
   * view canonicalises to #/season/<id>, list views carry both query params, and
   * detail views own their URL.
   *
   * replaceState() does not fire hashchange, so the route state must be
   * refreshed by hand. Without this the season view keeps rendering the id that
   * was in the URL when it mounted: picking season 31 updates the address bar to
   * #/season/31 and the context, but `parts[1]` (the prop SeasonView renders)
   * stays 33. */
  const syncUrl = useCallback((season, group) => {
    const { parts } = parseHash();
    const view = parts[0] || "season";
    let hash;
    if (view === "season") hash = seasonHash(season);
    else if (LIST_VIEWS.has(view)) hash = contextHash(view, { season, group });
    else return;
    if (location.hash === hash) return;
    history.replaceState(null, "", hash);
    setRoute(parseHash());
  }, []);

  const changeSeason = (season) => {
    const groups = seasonGroups(season);
    const group = groups.some((g) => g.group_id === ctx.group) ? ctx.group : groups[0]?.group_id;
    setCtx({ season, group });
    syncUrl(season, group);
  };
  const changeGroup = (group) => {
    setCtx({ season: ctx.season, group });
    syncUrl(ctx.season, group);
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

  const content = (() => {
    switch (view) {
      case "teams":
        return id ? <TeamDetail ctx={ctx} id={id} onAdoptContext={adoptContext} /> : <TeamsView ctx={ctx} />;
      case "players":
        return id ? <PlayerDetail ctx={ctx} id={id} /> : <PlayersView ctx={ctx} />;
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
    document.documentElement.dataset.route = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    trackPageview();
  }, [route, ctx]);

  const palette = useMemo(() => PALETTES[theme], [theme]);

  return (
    <PaletteContext.Provider value={palette}>
      <div className="site-layout">
        <Topbar
          ctx={ctx}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSeasonChange={changeSeason}
          onGroupChange={changeGroup}
          onAdoptContext={adoptContext}
        />
        <Tabs active={active} ctx={ctx} />
        <main id="view">
          <ViewBoundary key={view + "/" + parts.slice(1).join("/") + "/" + ctx.season + "/" + ctx.group}>
            {content}
          </ViewBoundary>
        </main>
        <Footer />
      </div>
      <MobileNav active={active} ctx={ctx} />
    </PaletteContext.Provider>
  );
}

function setMetaThemeColor(theme) {
  const el = document.querySelector('meta[name="theme-color"]');
  if (el) el.setAttribute("content", theme === "light" ? "#f6f7f9" : "#101112");
}
