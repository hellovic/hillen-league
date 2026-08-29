-- ============================================================================
-- Hillen League (hillen-sports.com/hillenyouth) — SQLite schema
-- Covers: players, teams, games, per-player box scores, standings, leaderboards
-- Multi-season ready; first scrape targets Season 32, group 26 (YOUTH GIRLS U13)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Reference entities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seasons (
    season_id   INTEGER PRIMARY KEY,          -- e.g. 32 = 第三十二屆驍籃青少年籃球聯賽
    name        TEXT NOT NULL
);

-- Groups are season-scoped: the site reuses group ids across seasons with
-- different meanings (e.g. 26 = YOUTH GIRLS U13 in s32, YOUTH GIRL U11 GROUP A in s31)
CREATE TABLE IF NOT EXISTS groups (
    season_id   INTEGER NOT NULL REFERENCES seasons(season_id),
    group_id    INTEGER NOT NULL,              -- site group id (season-scoped)
    name        TEXT NOT NULL,
    PRIMARY KEY (season_id, group_id)
);

CREATE TABLE IF NOT EXISTS teams (
    team_id     INTEGER PRIMARY KEY,          -- site team id (stable across seasons)
    name        TEXT NOT NULL                 -- latest known name
);

CREATE TABLE IF NOT EXISTS players (
    player_id   INTEGER PRIMARY KEY,          -- site player id (global)
    name        TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Season-scoped entities
-- ---------------------------------------------------------------------------

-- Team's enrollment in a season + group, with club info shown on team page
CREATE TABLE IF NOT EXISTS season_teams (
    season_id        INTEGER NOT NULL REFERENCES seasons(season_id),
    team_id          INTEGER NOT NULL REFERENCES teams(team_id),
    group_id         INTEGER NOT NULL,
    manager          TEXT,
    captain_player_id INTEGER REFERENCES players(player_id),
    home_color       TEXT,
    away_color       TEXT,
    season_pts_for   INTEGER,                 -- 本季總得分
    season_pts_against INTEGER,               -- 本季總失分
    PRIMARY KEY (season_id, team_id),
    FOREIGN KEY (season_id, group_id) REFERENCES groups(season_id, group_id)
);

-- Official group standings snapshot (from division.php 分組表)
CREATE TABLE IF NOT EXISTS standings (
    season_id   INTEGER NOT NULL REFERENCES seasons(season_id),
    group_id    INTEGER NOT NULL,
    team_id     INTEGER NOT NULL REFERENCES teams(team_id),
    rank        INTEGER,                      -- 1-based position in the table
    gp          INTEGER,                      -- games played
    wins        INTEGER,                      -- 勝
    losses      INTEGER,                      -- 負
    forfeits    INTEGER,                      -- 棄
    diff        INTEGER,                      -- +/- point differential
    points      INTEGER,                      -- 分數 (ranking points)
    PRIMARY KEY (season_id, group_id, team_id),
    FOREIGN KEY (season_id, group_id) REFERENCES groups(season_id, group_id)
);

-- Player roster per season/team (from team page 隊員名單)
CREATE TABLE IF NOT EXISTS rosters (
    season_id   INTEGER NOT NULL REFERENCES seasons(season_id),
    team_id     INTEGER NOT NULL REFERENCES teams(team_id),
    player_id   INTEGER NOT NULL REFERENCES players(player_id),
    jersey_no   INTEGER,
    PRIMARY KEY (season_id, team_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Games
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS games (
    event_id     INTEGER PRIMARY KEY,         -- site event id
    season_id    INTEGER NOT NULL REFERENCES seasons(season_id),
    group_id     INTEGER NOT NULL,
    game_date    TEXT,                        -- YYYY-MM-DD
    start_time   TEXT,                        -- e.g. "09:00 PM"
    end_time     TEXT,                        -- e.g. "10:00 PM"
    venue        TEXT,
    home_team_id INTEGER NOT NULL REFERENCES teams(team_id),
    away_team_id INTEGER NOT NULL REFERENCES teams(team_id),
    home_score   INTEGER,
    away_score   INTEGER,
    status       TEXT NOT NULL DEFAULT 'completed',  -- completed | forfeit | not_played | scheduled
    FOREIGN KEY (season_id, group_id) REFERENCES groups(season_id, group_id)
);

-- Quarter-by-quarter scores per team
CREATE TABLE IF NOT EXISTS game_quarters (
    event_id    INTEGER NOT NULL REFERENCES games(event_id),
    team_id     INTEGER NOT NULL REFERENCES teams(team_id),
    q1 INTEGER, q2 INTEGER, q3 INTEGER, q4 INTEGER, ot INTEGER,
    PRIMARY KEY (event_id, team_id)
);

-- Team-level game summary (from scores.php performance-count + shirt colors)
CREATE TABLE IF NOT EXISTS game_team_stats (
    event_id     INTEGER NOT NULL REFERENCES games(event_id),
    team_id      INTEGER NOT NULL REFERENCES teams(team_id),
    shirt_color  TEXT,                        -- (紫) etc. from game header
    turnovers    INTEGER,                     -- 失誤
    rebounds     INTEGER,                     -- 籃板
    fastbreaks   INTEGER,                     -- 快攻
    PRIMARY KEY (event_id, team_id)
);

-- Per-player box score per game (from scores.php 主隊/客隊總計數據)
CREATE TABLE IF NOT EXISTS player_game_stats (
    event_id   INTEGER NOT NULL REFERENCES games(event_id),
    player_id  INTEGER NOT NULL REFERENCES players(player_id),
    team_id    INTEGER NOT NULL REFERENCES teams(team_id),
    jersey_no  INTEGER,
    minutes    TEXT,                          -- "MM:SS"
    fg2m INTEGER, fg2a INTEGER, fg2_pct REAL,
    fg3m INTEGER, fg3a INTEGER, fg3_pct REAL,
    fgm  INTEGER, fga  INTEGER, fg_pct  REAL,
    ftm  INTEGER, fta  INTEGER, ft_pct  REAL,
    off_reb INTEGER, def_reb INTEGER, tot_reb INTEGER,
    ast INTEGER, stl INTEGER, blk INTEGER,
    fb  INTEGER,                              -- fast-break points
    ba  INTEGER,                              -- blocked-against
    tov INTEGER, pf INTEGER,
    eff INTEGER, plus_minus INTEGER, pts INTEGER,
    PRIMARY KEY (event_id, player_id)
);

-- Season leaderboards (from statistics.php top-N per category)
CREATE TABLE IF NOT EXISTS stat_leaderboards (
    season_id    INTEGER NOT NULL REFERENCES seasons(season_id),
    group_id     INTEGER NOT NULL,
    category     TEXT NOT NULL,               -- mvp | pts | fg3 | ast | stl | ft | reb | blk
    category_cn  TEXT NOT NULL,               -- 得分王 etc.
    rank         INTEGER,
    player_id    INTEGER NOT NULL REFERENCES players(player_id),
    team_id      INTEGER NOT NULL REFERENCES teams(team_id),
    games_played INTEGER,
    total        REAL,
    avg          REAL,
    PRIMARY KEY (season_id, group_id, category, rank),
    FOREIGN KEY (season_id, group_id) REFERENCES groups(season_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_pgs_player ON player_game_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_pgs_event  ON player_game_stats(event_id);
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season_id);
CREATE INDEX IF NOT EXISTS idx_games_group  ON games(group_id);
CREATE INDEX IF NOT EXISTS idx_rosters_player ON rosters(player_id);

-- Last data refresh timestamp (HK time) written by the refresh pipeline
-- (start.sh / GitHub Actions) after a full scrape. The dashboard footer shows
-- this as "data refresh YYYY-mm-dd HH:mm:ss". Stored in the DB (not derived
-- from the file mtime) so it survives git checkouts and dev-side scrapes.
CREATE TABLE IF NOT EXISTS refresh_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- ============================================================================
-- Analysis views (computed from raw data)
-- ============================================================================

-- A "played" game requires actual minutes on court. Box-score rows with
-- 0:00 / missing minutes are did-not-play entries (the league lists bench
-- players in the box score but excludes them from season stats and game logs).
CREATE VIEW IF NOT EXISTS v_played_games AS
SELECT * FROM player_game_stats
WHERE minutes IS NOT NULL AND minutes != '' AND minutes != '0:00';

-- Per-player season totals (only games actually played)
CREATE VIEW IF NOT EXISTS v_player_season_totals AS
SELECT
    pgs.player_id,
    p.name                                   AS player_name,
    g.season_id,
    pgs.team_id,
    t.name                                   AS team_name,
    g.group_id,
    gr.name                                  AS group_name,
    COUNT(*)                                 AS gp,
    -- "MM:SS" -> decimal minutes, computed inline (a helper join would fan out
    -- rows because many players share identical minute strings)
    ROUND(SUM(CAST(substr(pgs.minutes, 1, instr(pgs.minutes, ':') - 1) AS REAL)
              + CAST(substr(pgs.minutes, instr(pgs.minutes, ':') + 1) AS REAL) / 60.0), 2)
                                             AS minutes,
    SUM(pgs.fg2m)                            AS fg2m,
    SUM(pgs.fg2a)                            AS fg2a,
    SUM(pgs.fg3m)                            AS fg3m,
    SUM(pgs.fg3a)                            AS fg3a,
    SUM(pgs.fgm)                             AS fgm,
    SUM(pgs.fga)                             AS fga,
    SUM(pgs.ftm)                             AS ftm,
    SUM(pgs.fta)                             AS fta,
    SUM(pgs.off_reb)                         AS off_reb,
    SUM(pgs.def_reb)                         AS def_reb,
    SUM(pgs.tot_reb)                         AS tot_reb,
    SUM(pgs.ast)                             AS ast,
    SUM(pgs.stl)                             AS stl,
    SUM(pgs.blk)                             AS blk,
    SUM(pgs.fb)                              AS fb,
    SUM(pgs.ba)                              AS ba,
    SUM(pgs.tov)                             AS tov,
    SUM(pgs.pf)                              AS pf,
    SUM(pgs.eff)                             AS eff,
    SUM(pgs.plus_minus)                      AS plus_minus,
    SUM(pgs.pts)                             AS pts
FROM v_played_games pgs
JOIN players p  ON p.player_id  = pgs.player_id
JOIN games   g  ON g.event_id   = pgs.event_id
JOIN teams   t  ON t.team_id    = pgs.team_id
JOIN groups  gr ON gr.season_id = g.season_id AND gr.group_id = g.group_id
GROUP BY pgs.player_id, g.season_id, pgs.team_id, g.group_id;

-- Per-player season averages
CREATE VIEW IF NOT EXISTS v_player_season_averages AS
SELECT *,
       ROUND(pts / gp, 2)  AS pts_per_game,
       ROUND(ast / gp, 2)  AS ast_per_game,
       ROUND(tot_reb / gp, 2) AS reb_per_game,
       ROUND(stl / gp, 2)  AS stl_per_game,
       ROUND(blk / gp, 2)  AS blk_per_game,
       ROUND(eff / gp, 2)  AS eff_per_game
FROM v_player_season_totals;

-- Per-team season totals (from completed + forfeit games; 'not_played' and
-- 'scheduled' games are excluded). Matches the site's official 分組表, where a
-- forfeit counts as a win for the higher-scoring team and 棄 (forfeit) for the
-- loser: GP = wins + losses + forfeits.
CREATE VIEW IF NOT EXISTS v_team_season_totals AS
SELECT
    team_id,
    season_id,
    group_id,
    COUNT(*)                                     AS gp,
    SUM(is_win)                                  AS wins,
    SUM(is_loss)                                 AS losses,
    SUM(is_forfeit)                              AS forfeits,
    SUM(pts_for)                                 AS pts_for,
    SUM(pts_against)                             AS pts_against
FROM (
    SELECT home_team_id AS team_id, season_id, group_id,
           CASE WHEN home_score > away_score THEN 1 ELSE 0 END AS is_win,
           CASE WHEN status = 'completed' AND home_score < away_score THEN 1 ELSE 0 END AS is_loss,
           CASE WHEN status = 'forfeit'    AND home_score < away_score THEN 1 ELSE 0 END AS is_forfeit,
           home_score AS pts_for, away_score AS pts_against
    FROM games WHERE status IN ('completed', 'forfeit')
    UNION ALL
    SELECT away_team_id AS team_id, season_id, group_id,
           CASE WHEN away_score > home_score THEN 1 ELSE 0 END AS is_win,
           CASE WHEN status = 'completed' AND away_score < home_score THEN 1 ELSE 0 END AS is_loss,
           CASE WHEN status = 'forfeit'    AND away_score < home_score THEN 1 ELSE 0 END AS is_forfeit,
           away_score AS pts_for, home_score AS pts_against
    FROM games WHERE status IN ('completed', 'forfeit')
)
GROUP BY team_id, season_id, group_id;
