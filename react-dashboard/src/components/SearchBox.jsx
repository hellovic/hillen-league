import { useCallback, useEffect, useRef, useState } from "react";
import { buildSearchIndex, groupName, searchMatches } from "../data.js";
import { go } from "../utils.js";
import { useIsPhone } from "../useMediaQuery.js";

/* Global search with the same behaviour as setupGlobalSearch(): focus runs the
 * search, typing is debounced 180 ms, results span every season/group, and
 * picking a hit from another context switches the selectors to match it.
 *
 * UX-20 — phone context:
 *  - a phone opens a full-screen search surface sized to window.visualViewport,
 *    so the software keyboard shrinks the sheet instead of hiding results;
 *  - the page behind it is scroll-locked (body position:fixed) and both scroll
 *    position and input focus are restored when it closes;
 *  - Escape, the Close button, tapping outside, or the phone back button all
 *    close it (back is handled with a history marker so it does not navigate);
 *  - each row is two lines: entity type + name, then Season · group context;
 *  - the input is a proper combobox (aria-expanded / aria-activedescendant)
 *    with Arrow/Home/End/Enter navigation;
 *  - desktop keeps the familiar dropdown and its three-line context rows. */
export default function SearchBox({ ctx, onAdoptContext }) {
  const isPhone = useIsPhone();
  const [q, setQ] = useState("");
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [surface, setSurface] = useState(false);
  const [active, setActive] = useState(-1);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const timer = useRef(null);
  const blurTimer = useRef(null);
  const savedScroll = useRef(0);
  const pushed = useRef(false);
  const openedLength = useRef(0);
  const suppressFocus = useRef(false);
  const openingRef = useRef(false);
  const pointerScroll = useRef(null);
  const navigating = useRef(false);
  const surfaceRef = useRef(false);
  const itemsRef = useRef(null);
  const closeRef = useRef(() => {});

  useEffect(() => {
    surfaceRef.current = surface;
    if (surface) openingRef.current = false;
  }, [surface]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const run = useCallback(
    (text) => {
      const needle = String(text || "").trim();
      if (!needle) {
        setItems(null);
        setOpen(surfaceRef.current);
        setActive(-1);
        return;
      }
      try {
        const idx = buildSearchIndex();
        setItems(searchMatches(idx, needle, ctx));
        setOpen(true);
        setActive(-1);
      } catch (e) {
        setOpen(false);
      }
    },
    [ctx.season, ctx.group]
  );

  useEffect(() => {
    clearTimeout(timer.current);
    /* On a phone results only exist inside the sheet: after it closes, do not
     * schedule another search (the debounce would otherwise reopen the
     * dropdown a moment after Escape/Close). */
    if (isPhone && !surface) {
      setOpen(false);
      return undefined;
    }
    timer.current = setTimeout(() => run(q), 180);
    return () => clearTimeout(timer.current);
  }, [q, run, surface, isPhone]);

  /* ------------------------------------------------------------------ phone
   * Open: remember the scroll offset, push a same-URL history entry carrying a
   * marker, lock the body. Close: pop that entry only when it is still the
   * current one (a route change may have replaced it), restore scroll + focus. */
  const openSurface = useCallback(() => {
    if (surfaceRef.current || openingRef.current) return;
    openingRef.current = true;
    savedScroll.current =
      pointerScroll.current != null
        ? pointerScroll.current
        : window.scrollY || window.pageYOffset || 0;
    pointerScroll.current = null;
    pushed.current = false;
    try {
      openedLength.current = window.history.length;
      const state = { ...(window.history.state || {}), hlSearch: true };
      window.history.pushState(state, "", window.location.href);
      pushed.current = true;
    } catch (e) {
      pushed.current = false;
    }
    setSurface(true);
    setOpen(true);
  }, []);

  const closeSurface = useCallback((options = {}) => {
    const { restore = true, pop = true } = options;
    openingRef.current = false;
    const canPop =
      pop &&
      pushed.current &&
      window.history.state &&
      window.history.state.hlSearch === true &&
      window.history.length === openedLength.current + 1;
    pushed.current = false;
    setSurface(false);
    setOpen(false);
    setActive(-1);
    if (canPop) {
      try {
        window.history.back();
      } catch (e) {
        /* history unavailable — closing still works */
      }
    }
    if (restore) {
      /* The browser restores the scroll position of the history entry it is
       * going back to *after* popstate, so re-apply the offset once the
       * traversal has settled (it is 0 for a sheet opened at the top). */
      window.scrollTo(0, savedScroll.current);
      window.setTimeout(() => window.scrollTo(0, savedScroll.current), 120);
    }
    suppressFocus.current = true;
    if (inputRef.current) inputRef.current.focus({ preventScroll: true });
    window.setTimeout(() => {
      suppressFocus.current = false;
    }, 400);
  }, []);
  closeRef.current = closeSurface;

  /* Route changes while the sheet is open (a result picked from elsewhere, a
   * programmatic navigation, or the user tapping a tab): drop the sheet without
   * unwinding history, so the new destination wins. */
  useEffect(() => {
    const onHash = () => {
      if (!surfaceRef.current) return;
      navigating.current = true;
      pushed.current = false;
      setSurface(false);
      setOpen(false);
      setActive(-1);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      closeRef.current({ restore: false, pop: false });
      const y = savedScroll.current;
      window.setTimeout(() => window.scrollTo(0, y), 30);
      window.setTimeout(() => window.scrollTo(0, y), 140);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!surface) return undefined;
    const body = document.body;
    const y = savedScroll.current;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.classList.add("search-open");
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.classList.remove("search-open");
      if (!navigating.current) window.scrollTo(0, y);
      navigating.current = false;
    };
  }, [surface]);

  /* Size the sheet to the visible viewport, including when the software
   * keyboard is open (visualViewport shrinks), and keep it on screen when iOS
   * scrolls the visual viewport. */
  useEffect(() => {
    if (!surface) return undefined;
    const el = boxRef.current;
    const vv = window.visualViewport;
    if (!el || !vv) return undefined;
    const apply = () => {
      el.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      el.style.setProperty("--vv-left", `${Math.round(vv.offsetLeft)}px`);
      el.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      el.style.setProperty("--vv-width", `${Math.round(vv.width)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [surface]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      if (surfaceRef.current) closeRef.current();
      else setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  /* Combobox: keep the visually active option scrolled into view. */
  useEffect(() => {
    if (active < 0) return;
    const el = document.getElementById(`gs-opt-${active}`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  /* Result groups, in the relevance order produced by searchMatches(): the
   * current group first, then the rest of the current season, then older
   * seasons (UX-04). Headings are plain divs — never anchors — so the result
   * list contract (`#global-results a[data-kind]`) stays intact. */
  const sections = (() => {
    const buckets = [
      { key: "group", label: "This group", items: [] },
      { key: "season", label: `Season ${ctx.season}`, items: [] },
      { key: "other", label: "Other seasons", items: [] },
    ];
    for (const it of items || []) {
      const bucket =
        it.season === ctx.season && it.group === ctx.group
          ? buckets[0]
          : it.season === ctx.season
          ? buckets[1]
          : buckets[2];
      bucket.items.push(it);
    }
    return buckets;
  })();

  const pick = (item) => {
    if (!item) return;
    pushed.current = false; /* picking navigates — do not unwind history */
    navigating.current = true; /* the route change owns the scroll position */
    setSurface(false);
    setOpen(false);
    setActive(-1);
    setQ("");
    setItems(null);
    if (item.season && item.group) {
      if (item.season !== ctx.season || item.group !== ctx.group) {
        onAdoptContext(item.season, item.group);
      }
    }
    go(item.href);
  };

  const clearQuery = () => {
    setQ("");
    setItems(null);
    setActive(-1);
    setOpen(surfaceRef.current);
    if (inputRef.current) inputRef.current.focus({ preventScroll: true });
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (surfaceRef.current) closeSurface();
      else {
        setOpen(false);
        setActive(-1);
        if (inputRef.current) inputRef.current.blur();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const list = itemsRef.current || [];
      if (!list.length) return;
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        if (next < 0) return list.length - 1;
        if (next >= list.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      const list = itemsRef.current || [];
      if (!list.length) return;
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : list.length - 1);
      return;
    }
    if (e.key === "Enter") {
      const list = itemsRef.current || [];
      if (active >= 0 && active < list.length) {
        e.preventDefault();
        pick(list[active]);
      }
    }
  };

  let optionIndex = -1;
  const hasItems = open && items && items.length > 0;

  return (
    <div className={`gsearch${surface ? " gsearch-surface" : ""}`} ref={boxRef}>
      <label className="search-label" htmlFor="global-search">
        Search the league
      </label>
      <div className="gs-actions">
        {q ? (
          <button type="button" className="gs-clear" onClick={clearQuery}>
            Clear
          </button>
        ) : null}
        <button
          type="button"
          className="gs-close"
          aria-label="Close search"
          onClick={() => closeSurface()}
        >
          ✕
        </button>
      </div>
      <input
        type="search"
        id="global-search"
        placeholder="Players, teams, games…"
        autoComplete="off"
        value={q}
        role="combobox"
        aria-label="Search players, teams and games"
        aria-autocomplete="list"
        aria-controls="global-results"
        aria-expanded={open ? "true" : "false"}
        aria-activedescendant={open && active >= 0 ? `gs-opt-${active}` : undefined}
        ref={inputRef}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (suppressFocus.current) return;
          if (isPhone) {
            openSurface();
            if (q.trim()) run(q);
            return;
          }
          run(q);
        }}
        onPointerDown={() => {
          /* The header is at the top of the page, but a programmatic or
           * keyboard focus can happen anywhere: remember the offset before the
           * browser scrolls the input into view (UX-20 restore). */
          if (isPhone && !surfaceRef.current && !openingRef.current) {
            pointerScroll.current = window.scrollY || window.pageYOffset || 0;
          }
        }}
        onClick={() => {
          /* After Escape/Close the input keeps focus, so a second tap does not
           * fire focus again — reopen from the click (UX-20). */
          if (isPhone && !surfaceRef.current && !openingRef.current) {
            openSurface();
            if (q.trim()) run(q);
          }
        }}
        onBlur={() => {
          clearTimeout(blurTimer.current);
          blurTimer.current = setTimeout(() => {
            const box = boxRef.current;
            const focus = document.activeElement;
            if (box && focus && box.contains(focus)) return;
            if (surfaceRef.current) closeSurface();
            else setOpen(false);
          }, 140);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        id="global-results"
        className={`global-results${open ? " open" : ""}`}
        role="listbox"
        aria-label="Search results"
      >
        {hasItems
          ? sections.map((section) =>
              section.items.length ? (
                <div className="gs-section-group" key={section.key}>
                  <div className="gs-section">{section.label}</div>
                  {section.items.map((it) => {
                    optionIndex += 1;
                    const idx = optionIndex;
                    return (
                      <a
                        key={`${it.kind}-${it.href}-${idx}`}
                        className="gs-item"
                        id={`gs-opt-${idx}`}
                        href={it.href}
                        role="option"
                        aria-selected={active === idx ? "true" : "false"}
                        data-kind={it.kind}
                        title={it.sub}
                        onClick={(e) => {
                          e.preventDefault();
                          pick(it);
                        }}
                      >
                        <span className="gs-k">{it.kind}</span>
                        <span className="gs-label">{it.label}</span>
                        <span className="gs-sub">{it.sub}</span>
                        <span className="gs-scope">
                          Season {it.season} · {groupName(it.season, it.group)}
                        </span>
                      </a>
                    );
                  })}
                </div>
              ) : null
            )
          : null}
        {open && surface && !q.trim() ? (
          <div className="gs-hint">
            Type a player, team or fixture name. Results cover every season and group.
          </div>
        ) : null}
        {open && surface && q.trim() && !items ? <div className="gs-empty">Searching…</div> : null}
        {open && items && items.length === 0 ? (
          <div className="gs-empty">
            No matches for “{q.trim()}”. Try a shorter name or a different season.
          </div>
        ) : null}
      </div>
    </div>
  );
}
