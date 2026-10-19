import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { go } from "../utils.js";

/* Generic sortable table — the React equivalent of makeTable() + bindSort().
 *
 * Controlled: the caller owns `sort` ({key, dir} or null) and `onSort(next)`.
 * Header clicks and Enter/Space (role=button) toggle sorting; rows with an href
 * navigate on click / Enter, exactly like the delegated handlers in app.js.
 *
 * Sticky header, two mechanisms:
 *  1. When the table fits its card, the card may become a plain block (`.fit`),
 *     and the design's own `table.data th{position:sticky}` sticks the header to
 *     the window.
 *  2. When the table is wider than its card — a 16-column box score on a phone,
 *     a long-name group on a narrow window — the card has to stay a horizontal
 *     scroll box, and a scroll box is also the sticky scrollport, so the header
 *     is trapped inside it and scrolls away with the page. For those tables a
 *     copy of the header row is rendered into a fixed strip (`thead-pin`) that
 *     follows the page while the real header is off-screen, and its horizontal
 *     scroll is mirrored to the card so the columns stay aligned. */
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
  const cardRef = useRef(null);
  const pinWrapRef = useRef(null);
  const pinScrollRef = useRef(null);
  const fitRef = useRef(false);
  const [pinGeom, setPinGeom] = useState({ cols: [], width: 0 });
  const sorted = sort && sort.key ? sort : null;

  const activate = useCallback(
    (col) => {
      if (!sortable || col.sortable === false || !onSort) return;
      if (sorted && sorted.key === col.key) {
        onSort({ key: col.key, dir: sorted.dir === "asc" ? "desc" : "asc" });
      } else {
        onSort({ key: col.key, dir: "desc" });
      }
    },
    [onSort, sortable, sorted]
  );

  /* `.fit` measurement (see 1. above) plus the pinned strip's visibility. */
  useEffect(() => {
    const table = tableRef.current;
    const card = table && table.closest(".card");
    if (!table || !card) return;
    cardRef.current = card;
    let frame = 0;

    const updatePin = () => {
      const wrap = pinWrapRef.current;
      const head = table.tHead;
      if (!wrap || !head) return;
      const cs = getComputedStyle(card);
      const cardRect = card.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft) || 0;
      /* Align the strip with the card's content box — where the real table sits
       * — rather than the viewport, so the columns line up on wide layouts. */
      wrap.style.left = `${cardRect.left + card.clientLeft + padL}px`;
      wrap.style.width = `${Math.max(0, card.clientWidth - padL)}px`;
      const headH = head.getBoundingClientRect().height;
      const rect = table.getBoundingClientRect();
      const on = !fitRef.current && rect.top < -1 && rect.bottom > headH;
      wrap.classList.toggle("on", on);
      wrap.style.height = `${headH}px`;
      if (on && pinScrollRef.current) pinScrollRef.current.scrollLeft = card.scrollLeft;
    };

    const measure = () => {
      card.classList.remove("fit");
      fitRef.current = table.scrollWidth <= card.clientWidth + 1;
      if (fitRef.current) card.classList.add("fit");
      /* Column geometry for the pinned copy. Measured here (not in an effect on
       * `rows`) because the widths also depend on the viewport: a table that is
       * stretched to its card on a desktop has wider columns than the same table
       * squeezed into a phone, and a resize must re-measure even when the rows
       * did not change. */
      if (table.tHead && table.tHead.rows[0]) {
        const cols = [...table.tHead.rows[0].cells].map((th) => {
          const r = th.getBoundingClientRect();
          return Math.round(r.width * 100) / 100;
        });
        const width = table.scrollWidth;
        setPinGeom((prev) => {
          const same =
            prev.width === width &&
            prev.cols.length === cols.length &&
            prev.cols.every((w, i) => Math.abs(w - cols[i]) < 0.5);
          return same ? prev : { cols, width };
        });
      }
      updatePin();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePin);
    };

    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(card);
    observer.observe(table);
    window.addEventListener("scroll", onScroll, { passive: true });
    card.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      card.removeEventListener("scroll", onScroll);
      card.classList.remove("fit");
    };
  }, [rows]);

  /* Dragging the pinned strip sideways pans the real table (and the reverse is
   * handled above), so the header behaves like part of the table. */
  const onPinScroll = () => {
    const card = cardRef.current;
    const scroller = pinScrollRef.current;
    if (!card || !scroller) return;
    if (Math.abs(card.scrollLeft - scroller.scrollLeft) > 1) {
      card.scrollLeft = scroller.scrollLeft;
    }
  };

  const headCells = (mirror) =>
    columns.map((col) => {
      const isSorted = sorted && sorted.key === col.key;
      const cls = `${col.num ? "num" : ""}${isSorted ? " sorted" : ""}`.trim();
      const clickable = sortable && col.sortable !== false;
      return (
        <th
          key={col.key ?? col.label}
          tabIndex={mirror ? -1 : clickable ? 0 : undefined}
          role={clickable ? "button" : undefined}
          data-key={clickable ? col.key : undefined}
          className={cls || undefined}
          onClick={clickable ? () => activate(col) : undefined}
          onKeyDown={
            clickable
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
    });

  return (
    <>
      <table ref={tableRef} className={`data${pin ? ` pin${pin}` : ""}`} id={tableId}>
        <thead>
          <tr>{headCells(false)}</tr>
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
      {createPortal(
        <div className="thead-pin" ref={pinWrapRef} aria-hidden="true">
          <div className="thead-pin-scroll" ref={pinScrollRef} onScroll={onPinScroll}>
            <table
              className={`data${pin ? ` pin${pin}` : ""}`}
              style={{ width: pinGeom.width ? `${pinGeom.width}px` : undefined, tableLayout: "fixed" }}
            >
              <colgroup>
                {pinGeom.cols.map((w, i) => (
                  <col key={i} style={{ width: `${w}px` }} />
                ))}
              </colgroup>
              <thead>
                <tr>{headCells(true)}</tr>
              </thead>
            </table>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
