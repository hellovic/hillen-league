import { useT } from "../locale.jsx";
import { meta } from "../data.js";

export default function Footer({gender = "girls"}) {
  const tr = useT();
  const c = meta.gender_counts?.[gender] || meta.counts || {};
  return (
    <footer className="foot">
      {tr("{gender} data snapshot", { gender: tr(gender === "boys" ? "Boys" : "Girls") })} · hillen-sports.com · CourtSide v1.2
      <br />
      <span id="foot-counts">
        {tr("{teams} teams · {players} players · {games} games · {boxScores} box-score rows", { ...c, boxScores: c.box_scores })}
      </span>
      <span id="foot-fresh">{meta.refreshed_at ? ` · ${tr("Data last changed {date}", { date: meta.refreshed_at })}` : ""}</span>
    </footer>
  );
}
