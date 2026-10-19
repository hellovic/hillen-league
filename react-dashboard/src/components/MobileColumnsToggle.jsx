import { useIsPhone } from "../useMediaQuery.js";

/* Phone-only "show the full table" button. On wider screens it renders nothing,
 * which keeps the desktop markup — and therefore the desktop layout — exactly as
 * it was before the phone column budget existed. Column visibility itself is CSS
 * (see ux-tables.css); this component only owns the button. */
export default function MobileColumnsToggle({
  controls,
  expanded,
  onToggle,
  label,
}) {
  const isPhone = useIsPhone();
  if (!isPhone) return null;
  return (
    <button
      type="button"
      className="table-cols-toggle"
      aria-controls={controls}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="table-cols-toggle-caret" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
      <span>{label}</span>
    </button>
  );
}
