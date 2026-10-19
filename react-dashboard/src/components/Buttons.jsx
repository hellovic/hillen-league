import { copyShareLink, csvDownload } from "../utils.js";

export function ShareButton({ kind, id }) {
  const what =
    kind === "games" ? "teams, date and score"
    : kind === "teams" ? "record and roster"
    : kind === "groups" ? "season standings"
    : kind === "seasons" ? "groups and records"
    : "statistics";
  const noun = kind === "groups" || kind === "seasons" ? kind.slice(0, -1) + "'s" : `${kind.slice(0, -1)}'s`;
  return (
    <button
      className="csv-btn"
      type="button"
      title={`Copy a link that previews this ${noun} ${what} in WhatsApp and other chat apps`}
      onClick={(e) => copyShareLink(e.currentTarget, kind, id)}
    >
      Copy link
    </button>
  );
}

export function CsvButton({ id, onDownload }) {
  return (
    <button
      className="csv-btn csv-export"
      type="button"
      id={id || undefined}
      title="Download as CSV"
      onClick={onDownload}
    >
      CSV
    </button>
  );
}

export { csvDownload };
