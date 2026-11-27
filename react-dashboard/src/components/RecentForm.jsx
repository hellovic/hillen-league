import { useT } from "../locale.jsx";
import { fmtDate, resultOf } from "../utils.js";

const OUTCOME = { W: "Win", L: "Loss", T: "Tie" };

export default function RecentForm({ teamId, results }) {
  const tr = useT();
  const games = results.filter((game) =>
    game.home_team_id === teamId || game.away_team_id === teamId
  ).slice(0, 5).reverse();
  return (
    <div className="recent-form-results">
      {games.length ? games.map((game) => {
        const { text, cls } = resultOf(game, teamId);
        const [letter, score] = text.split(" ");
        const opponent = game.home_team_id === teamId ? game.away_name : game.home_name;
        const label = `${fmtDate(game.game_date)} · ${opponent} · ${tr(OUTCOME[letter])} ${score}`;
        return (
          <a className={`recent-form-result ${cls}`} key={game.event_id}
            href={`#/games/${game.event_id}`} title={label} aria-label={label}>
            <span>{tr(letter)}</span>
          </a>
        );
      }) : <span className="muted" aria-label={tr("No games played yet")}>—</span>}
    </div>
  );
}
