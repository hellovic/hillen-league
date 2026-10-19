import { useEffect, useState } from "react";

/* Small viewport hook shared by the mobile-first workstreams.
 *
 * `useMediaQuery("(max-width: 767px)")` is evaluated client-side only: the
 * exported site is a static SPA with no SSR, so reading matchMedia at render
 * time is safe, and the server-rendered HTML never depends on it. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);
  return matches;
}

export function useIsPhone() {
  return useMediaQuery("(max-width: 767px)");
}
