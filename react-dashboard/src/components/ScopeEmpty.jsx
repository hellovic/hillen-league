/**
 * ScopeEmpty — shared explanatory empty state (UX-19) for a scoped section.
 *
 * Props
 *   title      required. Short headline, e.g. "No completed games yet".
 *   text       optional. One sentence explaining when the section fills in.
 *   href       optional. Where the reader should go instead (fixtures page…).
 *   linkLabel  optional. Label for that link (defaults to "View fixtures ↗").
 *   className  optional. Extra classes on the root <div>.
 */
export default function ScopeEmpty({ title, text, href, linkLabel = "View fixtures ↗", className = "" }) {
  return (
    <div className={`scope-empty${className ? ` ${className}` : ""}`}>
      <p className="scope-empty-title">{title}</p>
      {text ? <p className="scope-empty-text">{text}</p> : null}
      {href ? (
        <a className="scope-inline-link" href={href}>
          {linkLabel}
        </a>
      ) : null}
    </div>
  );
}
