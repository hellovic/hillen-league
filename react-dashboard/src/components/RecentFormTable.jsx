import { useT } from "../locale.jsx";
import { fmtDate, resultOf } from "../utils.js";

const OUTCOME = { W: "Win", L: "Loss", T: "Tie" };

export default function RecentFormTable({ standings, results }) {
  const tr = useT();
  return (
    <>
      <table className="data recent-form-table" aria-describedby="recent-form-note">
        <thead>
          <tr>
            {["#", "Team", "Record", "Recent form"].map((name) => <th key={name} scope="col">{tr(name)}</th>)}
          </tr>
        </thead>
        <tbody>
          {standings.map((team) => {
            const games = results.filter((game) =>
              game.home_team_id === team.team_id || game.away_team_id === team.team_id
            ).slice(0, 5).reverse();
            return (
              <tr key={team.team_id}>
                <td className="num">{team.pos ?? team.rank}</td>
                <td><a className="row-link" href={`#/teams/${team.team_id}`} title={team.team_name}>{team.team_name}</a></td>
                <td className="num od-nowrap">{team.wins}–{team.losses}</td>
                <td>
                  <div className="recent-form-results">
                    {games.length ? games.map((game) => {
                      const { text, cls } = resultOf(game, team.team_id);
                      const [letter, score] = text.split(" ");
                      const opponent = game.home_team_id === team.team_id ? game.away_name : game.home_name;
                      const label = `${fmtDate(game.game_date)} · ${opponent} · ${tr(OUTCOME[letter])} ${score}`;
                      return (
                        <a className={`recent-form-result ${cls}`} key={game.event_id}
                          href={`#/games/${game.event_id}`} title={label} aria-label={label}>
                          <span>{tr(letter)}</span>
                        </a>
                      );
                    }) : <span className="muted" aria-label={tr("No games played yet")}>—</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted recent-form-note" id="recent-form-note">{tr("Last 5 results · Latest on the right")}</p>
    </>
  );
}
