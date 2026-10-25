import { useEffect, useRef, useState } from "react";
import { api, groupName, scopeLabel } from "../data.js";
import { contextHash, csvDownload, go, hasResult, setTitle } from "../utils.js";
import { CsvButton } from "../components/Buttons.jsx";
import ScopeEmpty from "../components/ScopeEmpty.jsx";
import StatGuide from "../components/StatGuide.jsx";
import { GUIDE_GROUPS } from "../glossary.js";

const ORDER = ["mvp", "pts", "ast", "reb", "fg3", "blk", "ft", "stl"];

/* Group leaderboards. A group with no final/forfeit game has nothing to rank
 * (the bundle would otherwise serve eight all-zero tables), so it gets one
 * explanation and a link to the fixtures instead (UX-03 / UX-19).
 *
 * UX-17: eight leaderboards is a long page, so the top now carries a sticky
 * category strip. Tapping a category scrolls its table to the top of the
 * viewport; the active chip is marked with aria-current, a ✓ and bold text, and
 * the strip scrolls horizontally instead of wrapping long bilingual labels.
 * Ranking rows, order and CSV output are untouched. */
export default function LeadersView({ ctx }) {
  const [selected, setSelected] = useState(null);
  const [jumpH, setJumpH] = useState(0);
  const navRef = useRef(null);
  const stripRef = useRef(null);
  const chipRefs = useRef({});
  const lockUntil = useRef(0);
  const jumpHRef = useRef(0);

  useEffect(() => {
    jumpHRef.current = jumpH;
  }, [jumpH]);

  let leaders = [];
  try {
    leaders = api("leaders", ctx) || [];
  } catch (e) {
    leaders = [];
  }
  let teams = [];
  let games = [];
  try {
    teams = api("teams", ctx) || [];
    games = api("games", ctx) || [];
  } catch (e) {
    teams = [];
    games = [];
  }
  const resolved = games.filter(hasResult);

  useEffect(() => {
    setTitle(groupName(ctx.season, ctx.group), "Leaders", "Season " + ctx.season);
  }, [ctx.season, ctx.group]);

  const prio = (c) => {
    const i = ORDER.indexOf(c);
    return i === -1 ? ORDER.length + c : i;
  };
  const sorted = [...leaders].sort((a, b) => prio(a.category) - prio(b.category) || a.rank - b.rank);
  const cats = [];
  let cur = null;
  for (const r of sorted) {
    if (!cur || cur.key !== r.category) {
      cur = { key: r.category, cn: r.category_cn, items: [] };
      cats.push(cur);
    }
    cur.items.push(r);
  }
  const catsKey = cats.map((c) => c.key).join("|");

  /* Refused-on-category strip: first category is active until the reader scrolls
   * or taps another. Re-runs when the group/season (or its category list) change. */
  useEffect(() => {
    if (!cats.length) {
      setSelected(null);
      return;
    }
    setSelected(cats[0].key);
    lockUntil.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catsKey, ctx.season, ctx.group]);

  /* ResizeObserver keeps the sticky strip's height available to the scroll
   * anchor CSS (--leader-jump-h) without hard-coding a phone/desktop size. */
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setJumpH(el.offsetHeight || 0));
    ro.observe(el);
    setJumpH(el.offsetHeight || 0);
    return () => ro.disconnect();
  }, [catsKey]);

  /* Scroll spy: the topmost category whose table has passed just below the
   * sticky strip becomes the selected chip. A short lock after a tap stops a
   * second category in the same grid row from stealing the selection. */
  useEffect(() => {
    if (!cats.length) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      if (Date.now() < lockUntil.current) return;
      const threshold = (jumpHRef.current || 56) + 28;
      let next = cats[0].key;
      for (const c of cats) {
        const el = document.getElementById("lb-" + c.key);
        if (el && el.getBoundingClientRect().top <= threshold) next = c.key;
      }
      setSelected((prev) => (prev === next ? prev : next));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catsKey]);

  /* Keep the active chip reachable in the horizontally scrolling strip. */
  useEffect(() => {
    const strip = stripRef.current;
    const chip = selected ? chipRefs.current[selected] : null;
    if (!strip || !chip) return;
    const sr = strip.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    if (cr.left < sr.left + 8) strip.scrollLeft += cr.left - sr.left - 8;
    else if (cr.right > sr.right - 8) strip.scrollLeft += cr.right - sr.right + 8;
  }, [selected]);

  const jumpTo = (key) => {
    setSelected(key);
    lockUntil.current = Date.now() + 900;
    const el = document.getElementById("lb-" + key);
    if (!el) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  if (!teams.length) {
    return (
      <>
        <div className="view-head">
          <div className="view-head-copy">
            <p className="eyebrow">{scopeLabel(ctx.season, ctx.group)}</p>
            <h2>Leaders</h2>
          </div>
        </div>
        <div className="card">
          <ScopeEmpty
            title="No teams in this group yet"
            text="Leaderboards appear once the group is drawn and results are recorded."
            href={"#/standings?season=" + ctx.season + "&group=" + ctx.group}
            linkLabel="View standings ↗"
          />
        </div>
      </>
    );
  }

  if (!resolved.length || !leaders.length) {
    return (
      <>
        <div className="view-head">
          <div className="view-head-copy">
            <p className="eyebrow">{scopeLabel(ctx.season, ctx.group)}</p>
            <h2>Leaders</h2>
          </div>
        </div>
        <div className="card">
          <ScopeEmpty
            title={resolved.length ? "No leaderboards yet" : "No games played yet"}
            text={
              resolved.length
                ? "This group has results but no leaderboard rows in the data bundle yet."
                : "Leaderboards appear after the first final. Until then this group has no stats to rank."
            }
            href={contextHash("games", ctx)}
            linkLabel="View fixtures ↗"
          />
        </div>
      </>
    );
  }

  const downloadCsv = () =>
    csvDownload(
      "leaders.csv",
      ["Category", "Rank", "Player", "Team", "GP", "Total", "Avg"],
      sorted.map((r) => [r.category_cn, r.rank, r.player_name, r.team_name, r.games_played, r.total, r.avg])
    );

  return (
    <div className="leaders-view" style={jumpH ? { "--leader-jump-h": `${jumpH}px` } : undefined}>
      <div className="view-head">
        <div className="view-head-copy">
          <p className="eyebrow">{scopeLabel(ctx.season, ctx.group)}</p>
          <h2>Leaders</h2>
        </div>
        <div className="toolbar">
          <div className="sub">
            {cats.length} categories · {resolved.length} played · {groupName(ctx.season, ctx.group)}
          </div>
          <StatGuide items={GUIDE_GROUPS.leaders} />
          <CsvButton onDownload={downloadCsv} />
        </div>
      </div>

      <nav className="leader-jump" aria-label="Leaderboard categories" ref={navRef}>
        <p className="leader-jump-label">Leaderboard categories</p>
        <div className="leader-jump-strip" ref={stripRef} role="group" aria-label="Jump to a category">
          {cats.map((cat) => {
            const en = cat.key.toUpperCase();
            const isCurrent = selected === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                className={`leader-chip${isCurrent ? " is-current" : ""}`}
                ref={(el) => {
                  chipRefs.current[cat.key] = el;
                }}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => jumpTo(cat.key)}
                title={`Jump to ${cat.cn}${cat.cn.toUpperCase() !== en ? ` (${en})` : ""} leaderboard`}
              >
                {isCurrent ? (
                  <span className="leader-chip-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
                <span className="leader-chip-cn">{cat.cn}</span>
                {cat.cn.toUpperCase() !== en ? <span className="leader-chip-en">{en}</span> : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="grid-2">
        {cats.map((cat) => (
          <div className="card leaderboard-card" id={`lb-${cat.key}`} key={cat.key}>
            <h3>
              {cat.cn} <span className="cn">{cat.key}</span>
            </h3>
            <table className="data leaderboard-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th className="num">GP</th>
                  <th className="num">Total</th>
                  <th className="num">Avg</th>
                </tr>
              </thead>
              <tbody>
                {cat.items.map((r) => (
                  <tr
                    key={`${r.category}-${r.rank}-${r.player_id}`}
                    tabIndex={0}
                    data-href={`#/players/${r.player_id}`}
                    onClick={(e) => {
                      if (e.target.closest("a")) return;
                      go(`#/players/${r.player_id}`);
                    }}
                    onKeyDown={(e) => {
                      /* Same keyboard contract as SortTable rows: Enter/Space
                       * opens the row, but a focused link keeps its own
                       * destination. */
                      if (e.target.closest("a")) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        go(`#/players/${r.player_id}`);
                      }
                    }}
                  >
                    <td className="num">{r.rank}</td>
                    <td>
                      <a className="row-link" href={`#/players/${r.player_id}`}>
                        {r.player_name}
                      </a>
                    </td>
                    <td>
                      <a className="row-link" style={{ color: "var(--muted)" }} href={`#/teams/${r.team_id}`}>
                        {r.team_name}
                      </a>
                    </td>
                    <td className="num">{r.games_played ?? "—"}</td>
                    <td className="num">{r.total ?? "—"}</td>
                    <td className="num">{r.avg ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
