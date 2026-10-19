/* PostHog page views for a hash-routed SPA.
 *
 * The loader in index.html registers window.posthog (and only initialises it on
 * the real, non-localhost site). Because capture_pageview is off, we fire
 * $pageview ourselves on every route change and match it with $pageleave so Web
 * analytics can compute bounce rate and session duration.
 *
 * $pathname is always the hash route (/standings, /teams/1595, /compare/…), never
 * the single /hillen-league/ path: PostHog derives $pathname from $current_url
 * and drops the fragment, so without this rewrite every page would collapse into
 * one row in the Pages report. The season/group query is dropped too — it refines
 * a route (which season's standings) rather than naming another page.
 *
 * On localhost the stub's capture() is a no-op, so this is inert in `npm run dev`.
 */

let lastRoute = null;

function currentRoute() {
  return ((location.hash || "#/").replace(/^#/, "").split("?")[0]) || "/";
}

function canSend() {
  return !!(window.posthog && typeof window.posthog.capture === "function");
}

export function trackPageview() {
  if (!canSend()) return;
  try {
    const route = currentRoute();
    if (lastRoute !== null && lastRoute !== route) {
      window.posthog.capture("$pageleave", { $current_url: location.href, $pathname: lastRoute });
    }
    window.posthog.capture("$pageview", { $current_url: location.href, $pathname: route });
    lastRoute = route;
  } catch (e) {
    /* analytics must never break the dashboard */
  }
}

/** Register the unload handler once; call from src/main.jsx. */
export function initAnalytics() {
  window.addEventListener("pagehide", () => {
    if (!canSend()) return;
    try {
      window.posthog.capture("$pageleave", { $current_url: location.href, $pathname: currentRoute() });
    } catch (e) {
      /* ignore */
    }
  });
}
