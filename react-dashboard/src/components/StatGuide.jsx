import { GLOSSARY } from "../glossary.js";

/* A native <details> disclosure: tap- and keyboard-operable, no hover-only
 * tooltips, and announced as an expand/collapse control (UX-07). */
export default function StatGuide({ items = [], label = "Stat guide", className = "" }) {
  const entries = items
    .map((key) => ({ key, ...GLOSSARY[key] }))
    .filter((entry) => entry.label);
  if (!entries.length) return null;
  return (
    <details className={`stat-guide${className ? ` ${className}` : ""}`}>
      <summary>{label}</summary>
      <dl>
        {entries.map((entry) => (
          <div key={entry.key}>
            <dt>{entry.label}</dt>
            <dd>{entry.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
