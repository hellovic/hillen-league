import { useEffect, useRef, useState } from "react";
import { buildSearchIndex, searchMatches } from "../data.js";
import { go } from "../utils.js";

/* Global search with the same behaviour as setupGlobalSearch(): focus runs the
 * search, typing is debounced 180 ms, results span every season/group, and
 * picking a hit from another context switches the selectors to match it. */
export default function SearchBox({ ctx, onAdoptContext }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const timer = useRef(null);

  const run = (text) => {
    const needle = text.trim();
    if (!needle) {
      setItems(null);
      setOpen(false);
      return;
    }
    try {
      const idx = buildSearchIndex();
      setItems(searchMatches(idx, needle, ctx));
      setOpen(true);
    } catch (e) {
      setOpen(false);
    }
  };

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(q), 180);
    return () => clearTimeout(timer.current);
    /* Re-run when the scope changes so "This group" keeps meaning the group the
     * dashboard is showing (UX-04). */
  }, [q, ctx.season, ctx.group]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

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
    setOpen(false);
    setQ("");
    if (item.season && item.group) {
      if (item.season !== ctx.season || item.group !== ctx.group) {
        onAdoptContext(item.season, item.group);
      }
    }
    go(item.href);
  };

  return (
    <div className="gsearch" ref={boxRef}>
      <label className="search-label" htmlFor="global-search">
        Search the league
      </label>
      <input
        type="search"
        id="global-search"
        placeholder="Players, teams, games…"
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => run(q)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div
        id="global-results"
        className={`global-results${open ? " open" : ""}`}
        role="listbox"
        aria-label="Search results"
      >
        {open && items
          ? items.length
            ? sections.map((section) =>
                section.items.length ? (
                  <div className="gs-section-group" key={section.key}>
                    <div className="gs-section">{section.label}</div>
                    {section.items.map((it, i) => (
                      <a
                        key={`${it.kind}-${it.href}-${i}`}
                        className="gs-item"
                        href={it.href}
                        data-kind={it.kind}
                        onClick={(e) => {
                          e.preventDefault();
                          pick(it);
                        }}
                      >
                        <span className="gs-k">{it.kind}</span>
                        <span className="gs-label">{it.label}</span>
                        <span className="gs-sub">{it.sub}</span>
                      </a>
                    ))}
                  </div>
                ) : null
              )
            : <div className="gs-empty">No matches</div>
          : null}
      </div>
    </div>
  );
}
