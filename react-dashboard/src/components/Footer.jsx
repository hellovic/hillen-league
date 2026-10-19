import { meta } from "../data.js";

export default function Footer() {
  const c = meta.counts || {};
  return (
    <footer className="foot">
      League data snapshot · hillen-sports.com
      <br />
      <span id="foot-counts">
        {`${c.teams} teams · ${c.players} players · ${c.games} games · ${c.box_scores} box-score rows`}
      </span>
      <span id="foot-fresh">{meta.refreshed_at ? ` · data refresh ${meta.refreshed_at}` : ""}</span>
    </footer>
  );
}
