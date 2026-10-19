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
      setItems(searchMatches(idx, needle));
      setOpen(true);
    } catch (e) {
      setOpen(false);
    }
  };

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(q), 180);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

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
            ? items.map((it, i) => (
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
                  <span className="gs-k">{it.kind}</span> {it.label} <span className="gs-sub">{it.sub}</span>
                </a>
              ))
            : <div className="gs-empty">No matches</div>
          : null}
      </div>
    </div>
  );
}
