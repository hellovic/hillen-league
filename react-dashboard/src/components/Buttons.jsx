import { useLocale, useT } from "../locale.jsx";
import { useEffect, useRef, useState } from "react";
import { copyShareLink, csvDownload } from "../utils.js";

export function ShareButton({ kind, id }) {
  const { language, t: tr } = useLocale();
  const [copied, setCopied] = useState(false);
  const timeout = useRef(null);
  useEffect(() => () => clearTimeout(timeout.current), []);
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
      title={language === "zh-Hant" ? tr("Copy a share link") : `Copy a link that previews this ${noun} ${what} in WhatsApp and other chat apps`}
      onClick={() => copyShareLink(kind, id, () => {
        setCopied(true);
        clearTimeout(timeout.current);
        timeout.current = setTimeout(() => setCopied(false), 1500);
      })}
    >
      {tr(copied ? "✓ Copied" : "Copy link")}
    </button>
  );
}

export function CsvButton({ id, onDownload }) {
  const tr = useT();
  return (
    <button
      className="csv-btn csv-export"
      type="button"
      id={id || undefined}
      title={tr("Download as CSV")}
      onClick={onDownload}
    >
      CSV
    </button>
  );
}

export { csvDownload };
