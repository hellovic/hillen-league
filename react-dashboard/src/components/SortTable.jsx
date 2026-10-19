import { useEffect, useRef } from "react";
import { go } from "../utils.js";

/* Generic sortable table — the React equivalent of makeTable() + bindSort().
 *
 * Controlled: the caller owns `sort` ({key, dir} or null) and `onSort(next)`.
 * Header clicks and Enter/Space (role=button) toggle sorting; rows with an href
 * navigate on click / Enter, exactly like the delegated handlers in app.js.
 *
 * It also decides whether the surrounding card may become a plain block
 * (`.fit`) instead of a horizontal scroll box. That is what lets the sticky
 * header in tweaks.css stick to the window: a sticky element is trapped by the
 * nearest scroll container, and design.css makes every table card one. A card may
 * only give up its scroll box while the table actually fits inside it — a long
 * name in one group must not turn into a page-wide horizontal scrollbar. */
export default function SortTable({
  columns,
  rows,
  renderRow,
  rowKey,
  rowHref,
  rowClass,
  tableId,
  pin = 0,
  sort,
  onSort,
  sortable = true,
  footer,
  emptyText = "No data",
}) {
  const tableRef = useRef(null);
  const sorted = sort && sort.key ? sort : null;

  /* Toggle `.fit` on the card: measured with the card's own scroll box in place,
   * so `scrollWidth > clientWidth` is exactly "the table does not fit". Re-runs
   * whenever the row set changes (sort, search, another group), because that can
   * change the intrinsic width. */
  useEffect(() => {
    const table = tableRef.current;
    const card = table && table.closest(".card");
    if (!table || !card) return;
    let frame = 0;
    const measure = () => {
      card.classList.remove("fit");
      if (table.scrollWidth <= card.clientWidth + 1) card.classList.add("fit");
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(card);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      card.classList.remove("fit");
    };
  }, [rows]);

  const activate = (col) => {
    if (!sortable || col.sortable === false || !onSort) return;
    if (sorted && sorted.key === col.key) {
      onSort({ key: col.key, dir: sorted.dir === "asc" ? "desc" : "asc" });
    } else {
      onSort({ key: col.key, dir: "desc" });
    }
  };
  return (
    <table ref={tableRef} className={`data${pin ? ` pin${pin}` : ""}`} id={tableId}>
      <thead>
        <tr>
          {columns.map((col) => {
            const isSorted = sorted && sorted.key === col.key;
            const cls = `${col.num ? "num" : ""}${isSorted ? " sorted" : ""}`.trim();
            return (
              <th
                key={col.key ?? col.label}
                tabIndex={sortable && col.sortable !== false ? 0 : undefined}
                role={sortable && col.sortable !== false ? "button" : undefined}
                data-key={sortable && col.sortable !== false ? col.key : undefined}
                className={cls || undefined}
                onClick={sortable && col.sortable !== false ? () => activate(col) : undefined}
                onKeyDown={
                  sortable && col.sortable !== false
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          activate(col);
                        }
                      }
                    : undefined
                }
              >
                {col.label}
                {isSorted ? (sorted.dir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((row, i) => {
            const href = rowHref ? rowHref(row) : undefined;
            return (
              <tr
                key={rowKey ? rowKey(row) : i}
                tabIndex={href ? 0 : undefined}
                data-href={href}
                className={rowClass ? rowClass(row) : undefined}
                onClick={
                  href
                    ? (e) => {
                        if (e.target.closest("a")) return;
                        go(href);
                      }
                    : undefined
                }
                onKeyDown={
                  href
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          go(href);
                        }
                      }
                    : undefined
                }
              >
                {renderRow(row)}
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={columns.length} className="empty">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
      {footer ? <tfoot>{footer}</tfoot> : null}
    </table>
  );
}
