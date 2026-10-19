import { go } from "../utils.js";

/* Generic sortable table — the React equivalent of makeTable() + bindSort().
 *
 * Controlled: the caller owns `sort` ({key, dir} or null) and `onSort(next)`.
 * Header clicks and Enter/Space (role=button) toggle sorting; rows with an href
 * navigate on click / Enter, exactly like the delegated handlers in app.js. */
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
  const sorted = sort && sort.key ? sort : null;
  const activate = (col) => {
    if (!sortable || col.sortable === false || !onSort) return;
    if (sorted && sorted.key === col.key) {
      onSort({ key: col.key, dir: sorted.dir === "asc" ? "desc" : "asc" });
    } else {
      onSort({ key: col.key, dir: "desc" });
    }
  };
  return (
    <table className={`data${pin ? ` pin${pin}` : ""}`} id={tableId}>
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
