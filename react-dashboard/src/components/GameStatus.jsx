import { gameStatus } from "../utils.js";

/**
 * GameStatus — the single visible badge for a fixture state (UX-02).
 *
 * Props
 *   game       required. A games payload row: `{ status, game_date, start_time }`.
 *   className  optional. Extra class names appended to the root <span>.
 *
 * Renders
 *   <span class="game-status game-status--<tone>" data-status="<code>">label</span>
 *   tones/codes/labels come from `gameStatus()` in utils.js:
 *   final ("Final"), forfeit ("Forfeit"), pending ("Result pending"),
 *   upcoming ("Scheduled").
 *
 * The badge is presentational only — never derive a fixture's state from its
 * text. Use `gameStatus()` / `hasResult()` for sorting, filtering, counts.
 */
export default function GameStatus({ game, className = "" }) {
  if (!game) return null;
  const st = gameStatus(game);
  return (
    <span
      className={`game-status game-status--${st.tone}${className ? ` ${className}` : ""}`}
      data-status={st.code}
    >
      {st.label}
    </span>
  );
}
