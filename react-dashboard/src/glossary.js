/* One glossary behind every “Stat guide” disclosure (UX-07 / UX-08). Labels and
 * definitions must match the numbers the dashboard prints; where a value comes
 * from the league feed it says so rather than inventing a formula. */
export const GLOSSARY = {
  points: {
    label: "Pts — standings points",
    text: "2 for a win, 1 for a loss, 0 for a forfeit. A team with no results has 0.",
  },
  tiebreak: {
    label: "Tie-break",
    text: "Teams level on points keep the league’s official entry order; the dashboard never invents a secondary sort.",
  },
  forfeits: {
    label: "F — forfeits",
    text: "Games lost by forfeit (棄權). A forfeit counts as a loss for the forfeiting team.",
  },
  diff: {
    label: "± — differential",
    text: "Points scored minus points conceded in the group’s results.",
  },
  gp: { label: "GP — games played", text: "Games with a final result (completed or forfeit)." },
  min: { label: "MIN — minutes", text: "Minutes on court. Per-game tables show minutes per game, one decimal." },
  eff: {
    label: "EFF — efficiency",
    text: "The league’s published efficiency rating (points, rebounds, assists, steals and blocks minus missed shots and turnovers). Shown per game in player tables.",
  },
  efg: {
    label: "eFG% — effective field-goal %",
    text: "(FG made + 0.5 × 3-point makes) ÷ FG attempts.",
  },
  ts: {
    label: "TS% — true-shooting %",
    text: "Points ÷ (2 × (FG attempts + 0.44 × FT attempts)).",
  },
  plusMinus: {
    label: "+/− — plus/minus",
    text: "Team points scored minus points conceded while the player is on court.",
  },
  stl: { label: "STL — steals", text: "Per-game tables label the average SPG." },
  blk: { label: "BLK — blocks", text: "Per-game tables label the average BPG." },
  reb: { label: "REB — rebounds", text: "Total rebounds. RPG is the per-game average." },
  ast: { label: "AST — assists", text: "APG is the per-game average." },
  tov: { label: "TO — turnovers", text: "Giveaways. Per-game tables label the average TO/G." },
  pf: { label: "PF — personal fouls", text: "Per-game tables label the average PF/G." },
  mvp: {
    label: "MVP ranking",
    text: "The league’s published MVP leaderboard for the group (hillen-sports.com). The dashboard shows its top five and does not recalculate it.",
  },
  leaders: {
    label: "Leaders",
    text: "Each category lists the top five for the selected season and group; TOTAL is the season total, AVG is per game.",
  },
  perGame: {
    label: "Totals vs per game",
    text: "Totals are counts over the season (PTS, REB); averages are totals ÷ GP and use one decimal (PPG, RPG).",
  },
  dash: {
    label: "— (dash)",
    text: "No record, no attempts, or not applicable. It is deliberately different from 0.",
  },
  rank: {
    label: "# / rank",
    text: "Display position after the league’s points order and its tie-break.",
  },
};

/* Which definitions each view shows. */
export const GUIDE_GROUPS = {
  standings: ["points", "tiebreak", "diff", "forfeits", "dash"],
  players: ["perGame", "min", "eff", "efg", "ts", "plusMinus", "dash"],
  leaders: ["leaders", "mvp", "points", "perGame", "eff"],
  boxscore: ["min", "eff", "plusMinus", "stl", "blk", "reb", "ast", "tov", "pf", "dash"],
  player: ["perGame", "min", "eff", "efg", "ts", "plusMinus", "dash"],
  compare: ["perGame", "eff", "stl", "blk", "tov", "pf", "dash"],
};
