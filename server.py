#!/usr/bin/env python3
"""
Hillen League dashboard server.

Zero-dependency (stdlib only) HTTP server that:
  * serves the static dashboard from ./dashboard/
  * exposes a read-only JSON API over hillen_league.db

Usage:
    python3 server.py [--port 8000] [--db hillen_league.db]
    python3 server.py --export docs                 # build the React site + share stubs
    python3 server.py --export-data FILE            # refresh the React app's data bundle

API:
    GET /api/meta                  seasons, groups, row counts
    GET /api/standings?season=&group=
    GET /api/teams?season=&group=
    GET /api/teams/<team_id>?season=
    GET /api/players?season=&group=
    GET /api/players/<player_id>?season=
    GET /api/games?season=&group=
    GET /api/games/<event_id>
    GET /api/leaders?season=&group=
"""

import argparse
import datetime
import json
import os
import re
import shutil
import sqlite3
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
HKTZ = datetime.timezone(datetime.timedelta(hours=8))  # the league runs in Hong Kong
STATIC_DIR = os.path.join(HERE, "dashboard")
# The React dashboard (Vite app) that the static export now publishes. The
# legacy vanilla dashboard/ is kept as the `python3 server.py` dev UI.
REACT_DIR = os.path.join(HERE, "react-dashboard")
DB_PATH = os.path.join(HERE, "hillen_league.db")
# Canonical public URL of the exported site. Needed because og:url must be
# absolute (crawlers don't resolve relative ones).
# must be absolute — link-preview crawlers don't resolve relative ones. Only the
# share pages use it; the dashboard itself stays origin-relative so it works on
# any host. Update here (and in dashboard/index.html) if the site ever moves.
SITE_URL = "https://hellovic.github.io/hillen-league/"

# `start_time` keeps the league's 12-hour clock ("02:00 PM"), which sorts wrong
# as text — "02:00 PM" < "09:00 AM". Fixture lists order by this expression
# instead: minutes since midnight, or -1 when the league has not set a time.
KICKOFF_MINUTES = """COALESCE(
            (CAST(substr(g.start_time, 1, 2) AS INTEGER) % 12
             + CASE WHEN g.start_time LIKE '%PM' THEN 12 ELSE 0 END) * 60
            + CAST(substr(g.start_time, 4, 2) AS INTEGER), -1)"""

QUERIES = {
    "meta": """
        SELECT 'seasons' AS k, COUNT(*) AS v FROM seasons
        UNION ALL SELECT 'groups', COUNT(*) FROM groups
        UNION ALL SELECT 'teams', COUNT(*) FROM teams
        UNION ALL SELECT 'players', COUNT(*) FROM players
        UNION ALL SELECT 'games', COUNT(*) FROM games
        UNION ALL SELECT 'box_scores', COUNT(*) FROM player_game_stats""",
    "standings": """
        SELECT s.rank, s.gp, s.wins, s.losses, s.forfeits, s.diff, s.points,
               t.team_id, t.name AS team_name
        FROM standings s JOIN teams t ON t.team_id = s.team_id
        WHERE s.season_id = ? AND s.group_id = ?
        ORDER BY s.rank""",
    "teams": """
        SELECT t.team_id, t.name AS team_name, st.group_id,
               st.manager, st.captain_player_id, cp.name AS captain_name,
               st.home_color, st.away_color, st.season_pts_for, st.season_pts_against,
               COALESCE(v.gp, 0) AS gp, COALESCE(v.wins, 0) AS wins,
               COALESCE(v.losses, 0) AS losses,
               COALESCE(v.pts_for, 0) AS pts_for, COALESCE(v.pts_against, 0) AS pts_against,
               COALESCE(v.pts_for, 0) - COALESCE(v.pts_against, 0) AS diff
        FROM season_teams st
        JOIN teams t ON t.team_id = st.team_id
        LEFT JOIN players cp ON cp.player_id = st.captain_player_id
        LEFT JOIN v_team_season_totals v
               ON v.team_id = st.team_id AND v.season_id = st.season_id
        WHERE st.season_id = ? AND st.group_id = ?
        ORDER BY COALESCE(v.wins, 0) DESC, diff DESC""",
    "team_detail": """
        SELECT t.team_id, t.name AS team_name, st.group_id, st.season_id,
               gr.name AS group_name,
               st.manager, st.captain_player_id, cp.name AS captain_name,
               st.home_color, st.away_color, st.season_pts_for, st.season_pts_against,
               COALESCE(v.gp, 0) AS gp, COALESCE(v.wins, 0) AS wins,
               COALESCE(v.losses, 0) AS losses,
               COALESCE(v.pts_for, 0) AS pts_for, COALESCE(v.pts_against, 0) AS pts_against
        FROM season_teams st
        JOIN teams t ON t.team_id = st.team_id
        JOIN groups gr ON gr.group_id = st.group_id AND gr.season_id = st.season_id
        LEFT JOIN players cp ON cp.player_id = st.captain_player_id
        LEFT JOIN v_team_season_totals v
               ON v.team_id = st.team_id AND v.season_id = st.season_id
        WHERE st.season_id = ? AND st.team_id = ?""",
    "roster": """
        SELECT r.jersey_no, p.player_id, p.name AS player_name
        FROM rosters r JOIN players p ON p.player_id = r.player_id
        WHERE r.season_id = ? AND r.team_id = ?
        ORDER BY COALESCE(r.jersey_no, 999), p.player_id""",
    "team_games": """
        SELECT g.event_id, g.game_date, g.start_time, g.venue, g.status,
               g.home_team_id, g.away_team_id, g.home_score, g.away_score,
               ht.name AS home_name, at.name AS away_name
        FROM games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        WHERE g.season_id = ? AND (g.home_team_id = ? OR g.away_team_id = ?)
        ORDER BY g.game_date""",
    "team_leaders": """
        SELECT player_id, player_name, gp, pts, tot_reb AS reb, ast, stl, blk, eff
        FROM v_player_season_totals
        WHERE season_id = ? AND team_id = ?
        ORDER BY pts DESC""",
    "players": """
        SELECT v.player_id, v.player_name, v.team_id, v.team_name, v.gp, v.minutes,
               v.pts, v.tot_reb AS reb, v.ast, v.stl, v.blk, v.eff,
               v.fgm, v.fga, v.fg3m, v.fg3a, v.ftm, v.fta, v.tov, v.pf,
               v.fb, v.ba, v.plus_minus,
               ROUND(v.pts * 1.0 / v.gp, 1) AS ppg,
               ROUND(v.tot_reb * 1.0 / v.gp, 1) AS rpg,
               ROUND(v.ast * 1.0 / v.gp, 1) AS apg,
               ROUND(v.stl * 1.0 / v.gp, 1) AS spg,
               ROUND(v.blk * 1.0 / v.gp, 1) AS bpg,
               ROUND(v.eff * 1.0 / v.gp, 1) AS effpg
        FROM v_player_season_totals v
        WHERE v.season_id = ? AND v.group_id = ?
        ORDER BY v.pts DESC""",
    "player_detail": """
        SELECT v.player_id, v.player_name, v.team_id, v.team_name, v.gp, v.minutes,
               v.pts, v.tot_reb AS reb, v.ast, v.stl, v.blk, v.eff,
               v.fgm, v.fga, v.fg2m, v.fg2a, v.fg3m, v.fg3a, v.ftm, v.fta,
               v.off_reb, v.def_reb, v.fb, v.ba, v.tov, v.pf, v.plus_minus
        FROM v_player_season_totals v
        WHERE v.season_id = ? AND v.player_id = ? AND v.group_id = ?
        ORDER BY v.team_id""",
    "player_games": """
        SELECT g.event_id, g.game_date, g.status, g.home_team_id, g.away_team_id,
               g.home_score, g.away_score, pgs.team_id, pgs.jersey_no, pgs.minutes,
               pgs.pts, pgs.fgm, pgs.fga, pgs.fg3m, pgs.fg3a, pgs.ftm, pgs.fta,
               pgs.off_reb, pgs.def_reb, pgs.tot_reb, pgs.ast, pgs.stl, pgs.blk,
               pgs.fb, pgs.ba, pgs.tov, pgs.pf, pgs.eff, pgs.plus_minus,
               opp.name AS opponent
        FROM player_game_stats pgs
        JOIN games g ON g.event_id = pgs.event_id
        JOIN teams opp ON opp.team_id =
             CASE WHEN g.home_team_id = pgs.team_id THEN g.away_team_id
                  ELSE g.home_team_id END
        WHERE pgs.player_id = ? AND g.season_id = ? AND g.group_id = ?
          AND pgs.minutes IS NOT NULL AND pgs.minutes != '' AND pgs.minutes != '0:00'
        ORDER BY g.game_date""",
    "games": """
        SELECT g.event_id, g.game_date, g.start_time, g.end_time, g.venue, g.status,
               g.home_team_id, g.away_team_id, g.home_score, g.away_score,
               ht.name AS home_name, at.name AS away_name
        FROM games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        WHERE g.season_id = ? AND g.group_id = ?
        ORDER BY g.game_date, g.event_id""",
    "game_detail": """
        SELECT g.*, ht.name AS home_name, at.name AS away_name,
               gr.name AS group_name
        FROM games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        JOIN groups gr ON gr.group_id = g.group_id AND gr.season_id = g.season_id
        WHERE g.event_id = ?""",
    "game_quarters": """
        SELECT q.* FROM game_quarters q WHERE q.event_id = ?""",
    "game_team_stats": """
        SELECT s.* FROM game_team_stats s WHERE s.event_id = ?""",
    "game_box": """
        SELECT pgs.*, p.name AS player_name
        FROM player_game_stats pgs JOIN players p ON p.player_id = pgs.player_id
        WHERE pgs.event_id = ?
        ORDER BY pgs.team_id, COALESCE(pgs.jersey_no, 999), pgs.player_id""",
    "leaders": """
        SELECT l.category, l.category_cn, l.rank,
               l.player_id, p.name AS player_name,
               l.team_id, t.name AS team_name,
               l.games_played, l.total, l.avg
        FROM stat_leaderboards l
        JOIN players p ON p.player_id = l.player_id
        JOIN teams   t ON t.team_id = l.team_id
        WHERE l.season_id = ? AND l.group_id = ?
        ORDER BY CASE l.category
                   WHEN 'mvp' THEN 1 WHEN 'pts' THEN 2 WHEN 'ast' THEN 3
                   WHEN 'reb' THEN 4 WHEN 'fg3' THEN 5 WHEN 'blk' THEN 6
                   WHEN 'ft'  THEN 7 WHEN 'stl' THEN 8
                   ELSE 99 END, l.rank""",
    "seasons": "SELECT season_id, name FROM seasons ORDER BY season_id",
    "groups": """SELECT g.season_id, g.group_id, g.name FROM groups g
                 ORDER BY g.season_id, g.group_id""",
    # aggregates for the season overview (one row per group / one for the season)
    "season_group_counts": """
        SELECT group_id, COUNT(*) AS teams
        FROM season_teams WHERE season_id = ? GROUP BY group_id""",
    "season_game_counts": """
        SELECT group_id, COUNT(*) AS games,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS played,
               MIN(game_date) AS first_game, MAX(game_date) AS last_game
        FROM games WHERE season_id = ? GROUP BY group_id""",
    "season_games_total": """
        SELECT COUNT(*) AS games,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS played,
               MIN(game_date) AS first_game, MAX(game_date) AS last_game
        FROM games WHERE season_id = ?""",
    "season_latest_games": f"""
        SELECT g.event_id, g.game_date, g.start_time, g.status, g.venue,
               g.group_id, gr.name AS group_name,
               ht.name AS home_name, at.name AS away_name,
               g.home_score, g.away_score
        FROM games g
        JOIN teams  ht ON ht.team_id = g.home_team_id
        JOIN teams  at ON at.team_id = g.away_team_id
        JOIN groups gr ON gr.group_id = g.group_id AND gr.season_id = g.season_id
        WHERE g.season_id = ? AND g.status IN ('completed', 'forfeit')
        ORDER BY g.game_date DESC, {KICKOFF_MINUTES} DESC, g.event_id DESC
        LIMIT 8""",
    "season_upcoming_games": f"""
        SELECT g.event_id, g.game_date, g.start_time, g.status, g.venue,
               g.group_id, gr.name AS group_name,
               ht.name AS home_name, at.name AS away_name,
               g.home_score, g.away_score
        FROM games g
        JOIN teams  ht ON ht.team_id = g.home_team_id
        JOIN teams  at ON at.team_id = g.away_team_id
        JOIN groups gr ON gr.group_id = g.group_id AND gr.season_id = g.season_id
        WHERE g.season_id = ? AND g.status = 'scheduled'
        ORDER BY g.game_date, {KICKOFF_MINUTES}, g.event_id
        LIMIT 5""",
    "season_teams_total": """
        SELECT COUNT(DISTINCT team_id) AS teams FROM season_teams WHERE season_id = ?""",
}


def query(conn, key, params=()):
    cur = conn.execute(QUERIES[key], params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def standings_rows(conn, season, group):
    """A group's table, ordered the way the dashboard shows it.

    division.php lists the teams in entry order and only starts agreeing with
    the points once games are played: season 33 group 11 opens with a team that
    has not played at all (0 GP, 0 pts) ahead of the 3-point leader. So sort by
    points and keep the official listing order as the tiebreak — that order is
    the league's own tiebreak once teams are level. `rank` stays as scraped;
    `pos` is the display position the UI and the share card show.
    """
    rows = query(conn, "standings", (season, group))
    rows.sort(key=lambda r: (-(r["points"] or 0), r["rank"]))
    for i, r in enumerate(rows, 1):
        r["pos"] = i
    return rows


# --------------------------------------------------------------------------
# API payload builders (shared by the live server and the static exporter)
# --------------------------------------------------------------------------

def meta_payload(conn, db_path=DB_PATH):
    counts = {r["k"]: r["v"] for r in query(conn, "meta")}
    # Every *registered* (season, group), not just the ones that already have
    # fixtures. A division the league has opened but not yet scheduled (season
    # 33's U15 girls: teams registered later, no games yet) would otherwise be
    # invisible in the dashboard while still being listed on the league site —
    # which is exactly how the five new season-33 divisions went missing.
    combos = [{"season": s, "group": g} for s, g in
              conn.execute("SELECT season_id, group_id FROM groups ORDER BY 1, 2")]
    row = conn.execute(
        "SELECT MIN(game_date), MAX(game_date) FROM games WHERE game_date IS NOT NULL").fetchone()
    # "data refresh" time: prefer the timestamp stored by the refresh pipeline
    # (start.sh / GitHub Actions) in refresh_meta; fall back to the database
    # file's last-write time. Either way shown in Hong Kong time so it's
    # consistent whether the refresh ran locally or on a (UTC) Actions runner.
    try:
        refresh_row = conn.execute("SELECT value FROM refresh_meta WHERE key='refreshed_at'").fetchone()
        refreshed_at = refresh_row[0] if refresh_row and refresh_row[0] else None
    except sqlite3.Error:
        refreshed_at = None
    if not refreshed_at:
        try:
            refreshed_at = datetime.datetime.fromtimestamp(os.path.getmtime(db_path), HKTZ) \
                .strftime("%Y-%m-%d %H:%M:%S")
        except OSError:
            refreshed_at = None
    return {
        "seasons": query(conn, "seasons"),
        "groups": query(conn, "groups"),
        "combos": combos,
        "counts": counts,
        "min_game_date": row[0],
        "max_game_date": row[1],
        "refreshed_at": refreshed_at,
        # The page a bare visit lands on (no #/route). The dashboard applies
        # these before its first render, so this is the single place to change
        # the default season/group. It must name a season/group that exists: if
        # the group is not in that season, the dashboard's rebuildGroups() falls
        # back to the season's first group.
        "default_season": 33,
        "default_group": 16,      # 第33屆 · YOUTH GIRLS U13
    }


def group_short(name):
    """A group name squeezed for a badge: "YOUTH GIRLS U11 GROUP A" -> "U11 A"."""
    return name.replace("YOUTH GIRLS ", "").replace(" GROUP ", " ")


def season_payload(conn, season):
    """Everything the season overview page shows, in one payload.

    One entry per *registered* group — played or not, because a division the
    league has opened is part of the season even before it has results — with
    just enough to describe it: how many teams, how many games are played, who
    leads it and who scores most for it. Ordering is left to the client (it has
    the age-order rule already, for the group switcher).
    """
    names = {r["season_id"]: r["name"] for r in query(conn, "seasons")}
    counts = {r["group_id"]: r["teams"] for r in query(conn, "season_group_counts", (season,))}
    gstats = {r["group_id"]: r for r in query(conn, "season_game_counts", (season,))}
    groups = []
    for g in query(conn, "groups"):
        if g["season_id"] != season:
            continue
        table = standings_rows(conn, season, g["group_id"])
        gs = gstats.get(g["group_id"]) or {}
        leader = None
        if table:
            top = table[0]                      # standings_rows() is points-ordered
            leader = {"team_id": top["team_id"], "team_name": top["team_name"],
                      "wins": top["wins"], "losses": top["losses"],
                      "points": top["points"]}
        scorer = None
        players = query(conn, "players", (season, g["group_id"]))
        if players:                             # this query is pts-descending
            p = players[0]
            gp = p["gp"] or 0
            scorer = {"player_id": p["player_id"], "player_name": p["player_name"],
                      "team_name": p["team_name"], "pts": p["pts"],
                      "ppg": round(p["pts"] / gp, 1) if gp else None}
        groups.append({
            "group_id": g["group_id"],
            "name": g["name"],
            "teams": counts.get(g["group_id"], len(table)),
            "games": gs.get("games") or 0,
            "played": gs.get("played") or 0,
            "last_game": gs.get("last_game"),
            "leader": leader,
            "top": scorer,
        })
    latest = [dict(r, group_short=group_short(r["group_name"]))
              for r in query(conn, "season_latest_games", (season,))]
    upcoming = [dict(r, group_short=group_short(r["group_name"]))
                for r in query(conn, "season_upcoming_games", (season,))]
    total = query(conn, "season_games_total", (season,))[0]
    return {
        "season_id": season,
        "season_name": names.get(season, f"Season {season}"),
        "totals": {
            "groups": len(groups),
            "teams": query(conn, "season_teams_total", (season,))[0]["teams"],
            "games": total["games"] or 0,
            "played": total["played"] or 0,
            "first_game": total["first_game"],
            "last_game": total["last_game"],
        },
        "groups": groups,
        "latest_games": latest,
        "upcoming_games": upcoming,
    }


def team_payload(conn, season, tid):
    rows = query(conn, "team_detail", (season, tid))
    if not rows:
        return None
    team = rows[0]
    team["roster"] = query(conn, "roster", (season, tid))
    team["games"] = query(conn, "team_games", (season, tid, tid))
    team["leaders"] = query(conn, "team_leaders", (season, tid))
    return team


def player_payload(conn, season, pid, group=None):
    """Season totals + game log for one player, scoped to a group.

    A player_id can represent more than one team in the same season (sometimes
    even within the same group). The player page is always shown in a group
    context, so we scope both the totals and the game log to that group and —
    when the player played for several teams within it — aggregate the rows so
    the "Season totals" card always matches the game log below it.
    """
    rows = query(conn, "player_detail", (season, pid, group))
    if not rows:
        return None
    if len(rows) == 1:
        player = dict(rows[0])
    else:
        # Same player, multiple teams within this group: sum the stats and
        # join the team labels so totals stay consistent with the game log.
        agg = dict(rows[0])
        for k in ("gp", "minutes", "pts", "reb", "ast", "stl", "blk", "eff",
                  "fgm", "fga", "fg2m", "fg2a", "fg3m", "fg3a", "ftm", "fta",
                  "off_reb", "def_reb", "fb", "ba", "tov", "pf", "plus_minus"):
            agg[k] = sum(r[k] or 0 for r in rows)
        agg["team_name"] = " / ".join(r["team_name"] for r in rows)
        player = agg
    player["games"] = query(conn, "player_games", (pid, season, group))
    return player


def game_payload(conn, eid):
    rows = query(conn, "game_detail", (eid,))
    if not rows:
        return None
    game = rows[0]
    game["quarters"] = query(conn, "game_quarters", (eid,))
    game["team_stats"] = query(conn, "game_team_stats", (eid,))
    game["box"] = query(conn, "game_box", (eid,))
    return game


def preview_page(kind, ident, title, desc, hash_target):
    """One shareable page for one entity (game / team / player), at a real path.

    Why this exists. The dashboard is a hash-routed SPA, and a URL fragment is
    never sent to the server: WhatsApp (or Telegram / Slack / iMessage / …)
    asking for .../#/games/20863 issues exactly the same request as one asking
    for the home page — same bytes, no trace of "20863" anywhere. Crawlers don't
    run JavaScript either, so they never see the score the app renders. Per-game
    cards are therefore impossible to produce from the hash URL at all.

    The fix is a real URL per entity. This writes `games/20863/index.html`, which
    GitHub Pages serves at /hillen-league/games/20863/. Its <head> carries that
    game's own Open Graph tags, so the crawler reads the real score, and the body
    hands a human straight to the SPA route via location.replace().

    Deliberately NO <meta http-equiv="refresh">: a refresh is a redirect a
    crawler may follow to the SPA root, which would hand it the generic site card
    again — the exact bug this fixes. A JS redirect is invisible to crawlers
    (they don't run JS) and instant for people; the <p> below is the no-JS
    fallback. hash_target is the hash route relative to the site root
    ("#/games/1"); the writer prepends exactly as many "../" as the stub is
    directories deep, so the export works under any host path, not just the
    production one.

    No og:image / twitter:image on purpose: a chat preview should be a compact
    text card. An image would also have to be a *generic* league banner standing
    in for a specific game, and WhatsApp always lets a thumbnail dominate the
    message. twitter:card is "summary" rather than "summary_large_image" so
    Twitter/X lays out a text card instead of reserving an image slot. This page
    body has no <img> either, so nothing can be picked up as a fallback.
    """
    from html import escape

    url = f"{SITE_URL}{kind}/{ident}/"
    e_title, e_desc = escape(title), escape(desc)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e_title} - Hillen League Dashboard</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Hillen League">
<meta property="og:title" content="{e_title}">
<meta property="og:description" content="{e_desc}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{e_title}">
<meta name="twitter:description" content="{e_desc}">
<script>location.replace({json.dumps(hash_target)});</script>
</head>
<body>
<p>Taking you to <a href="{escape(hash_target)}">{e_title}</a>…</p>
</body>
</html>
"""


def _react_source_signature():
    """Hash of the React dashboard's sources — an input to the cache-busting stamp."""
    import hashlib

    sig = ""
    skip_dirs = {"node_modules", "dist", "screenshots", "public", ".git"}
    for root, dirs, files in os.walk(REACT_DIR):
        dirs[:] = sorted(d for d in dirs if d not in skip_dirs)
        for name in sorted(files):
            if name == "package-lock.json":
                continue  # the built assets are identified by the stamp, not lock content
            p = os.path.join(root, name)
            rel = os.path.relpath(p, REACT_DIR)
            if rel.split(os.sep)[0] == "scripts":
                continue  # dev-only tooling, not shipped
            with open(p, "rb") as f:
                sig += rel + ":" + hashlib.md5(f.read()).hexdigest() + ";"
    return sig


def build_react_dashboard(out_dir):
    """Run `vite build` for react-dashboard/ into out_dir."""
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit(
            "npm is required to build the React dashboard — install Node.js 22+.\n"
            "(Only the static export needs it; the legacy vanilla dashboard has no build step.)"
        )
    if not os.path.isdir(os.path.join(REACT_DIR, "node_modules")):
        raise SystemExit(
            "react-dashboard/node_modules is missing — install it first:\n"
            "  npm ci --prefix react-dashboard"
        )
    subprocess.run(
        [npm, "run", "build", "--",
         "--outDir", os.path.abspath(out_dir), "--base", "./", "--emptyOutDir"],
        cwd=REACT_DIR,
        check=True,
    )


def build_league_bundle(conn, db_path=DB_PATH):
    """Every payload the React dashboard reads, keyed exactly as
    react-dashboard/src/data.js's api() looks it up: `meta`, `season/<id>`,
    `<season>/<group>/<path>` (lists and per-entity detail)."""
    mp = meta_payload(conn, db_path)
    bundle = {"meta": mp}
    for s in mp["seasons"]:
        bundle[f"season/{s['season_id']}"] = season_payload(conn, s["season_id"])
    for combo in mp["combos"]:
        season, group = combo["season"], combo["group"]
        prefix = f"{season}/{group}"
        teams = query(conn, "teams", (season, group))
        players = query(conn, "players", (season, group))
        games = query(conn, "games", (season, group))
        bundle[f"{prefix}/standings"] = standings_rows(conn, season, group)
        bundle[f"{prefix}/teams"] = teams
        bundle[f"{prefix}/players"] = players
        bundle[f"{prefix}/games"] = games
        bundle[f"{prefix}/leaders"] = query(conn, "leaders", (season, group))
        for t in teams:
            bundle[f"{prefix}/teams/{t['team_id']}"] = team_payload(conn, season, t["team_id"])
        for pl in players:
            bundle[f"{prefix}/players/{pl['player_id']}"] = player_payload(
                conn, season, pl["player_id"], group)
        for g in games:
            bundle[f"{prefix}/games/{g['event_id']}"] = game_payload(conn, g["event_id"])
    return bundle


def write_league_data(path, bundle):
    """Write the inline `window.LEAGUE_DATA = {…}` bundle the React app boots from."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* Generated by server.py — do not edit by hand.\n"
                "   The React dashboard's inline data bundle; its key scheme lives in\n"
                "   react-dashboard/src/data.js. Regenerate the dev snapshot with:\n"
                "     python3 server.py --export-data react-dashboard/public/league-data.js\n"
                "   The static export writes the same payload to docs/league-data.js. */\n")
        f.write("window.LEAGUE_DATA = ")
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    return os.path.getsize(path)


def export_react_data(out_file, db_path=DB_PATH):
    """CLI helper: refresh the dev-time data snapshot used by `npm run dev`."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        bundle = build_league_bundle(conn, db_path)
    finally:
        conn.close()
    size = write_league_data(out_file, bundle)
    print(f"wrote {out_file} ({size / 1e6:.2f} MB)")


def export_static(out_dir, db_path=DB_PATH):
    """Generate the fully static site published to GitHub Pages: the React
    dashboard (built with Vite), its inline data bundle, and the per-entity
    share stubs. Works on any static host (GitHub Pages, Netlify, Cloudflare…)."""
    if os.path.abspath(out_dir) == os.path.abspath(STATIC_DIR):
        raise SystemExit("refusing to export over dashboard/ — pick another dir, e.g. site/")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    # Vite owns index.html + assets/ — build it first, into the empty dir.
    build_react_dashboard(out_dir)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        mp = meta_payload(conn, db_path)
        season_names = {s["season_id"]: s["name"] for s in mp["seasons"]}
        group_names = {(g["season_id"], g["group_id"]): g["name"] for g in mp["groups"]}
        combos = mp["combos"]
        n_teams = n_players = n_games = 0
        # Share pages (see preview_page): one per entity. A team can be entered in
        # several seasons and a player in several seasons *and* groups, so record
        # the best context per id while looping and emit once at the end —
        # newest season, then (players only) most games played, then lowest group
        # id. Newest-season is the policy agreed for shared player links (71
        # players span 2+ seasons), so their page can't be ambiguous.
        game_ids, team_best, player_best, combo_keys = [], {}, {}, []
        for combo in combos:
            season, group = combo["season"], combo["group"]
            teams = query(conn, "teams", (season, group))
            players = query(conn, "players", (season, group))
            games = query(conn, "games", (season, group))
            combo_keys.append((season, group))
            for t in teams:
                n_teams += 1
                if (season, group) > team_best.get(t["team_id"], (0, 0)):
                    team_best[t["team_id"]] = (season, group)
            for pl in players:
                p = player_payload(conn, season, pl["player_id"], group)
                n_players += 1
                # -group so that, all else equal, the lower group id wins
                cand = (season, p["gp"] if p else 0, -group)
                if cand > player_best.get(pl["player_id"], (0, 0, 0)):
                    player_best[pl["player_id"]] = cand
            for g in games:
                n_games += 1
                game_ids.append(g["event_id"])

        # The React app reads all of its data from one inline bundle, so the whole
        # site is a single document plus one JS payload (≈270 KB gzipped) and every
        # route renders without a fetch waterfall.
        bundle_size = write_league_data(os.path.join(out_dir, "league-data.js"),
                                        build_league_bundle(conn, db_path))
        # ---- share pages: a real URL per entity (see preview_page) ----
        def write_share(kind, ident, title, desc, target):
            """target is a hash route relative to the site root, e.g. "#/games/1"."""
            ident = str(ident)
            pd = os.path.join(out_dir, kind, ident)
            os.makedirs(pd, exist_ok=True)
            # A stub lives one directory per path segment below the root
            # (games/20863/ is 2 deep, groups/33/11/ is 3), so climb back out of
            # exactly that many — plus the kind directory — to reach the site root.
            up = "../" * (ident.count("/") + 2)
            with open(os.path.join(pd, "index.html"), "w", encoding="utf-8") as f:
                f.write(preview_page(kind, ident, title, desc, up + target))

        n_share = 0
        for eid in game_ids:
            g = game_payload(conn, eid)
            if not g:
                continue
            scored = (g["status"] == "completed"
                      and g["home_score"] is not None and g["away_score"] is not None)
            title = (f"{g['home_name']} {g['home_score']}-{g['away_score']} {g['away_name']}"
                     if scored else f"{g['home_name']} vs {g['away_name']}")
            when = g["game_date"] or ""
            if g["start_time"]:
                when += (" " if when else "") + g["start_time"]
                if g["end_time"]:
                    when += "–" + g["end_time"]
            desc = " · ".join(x for x in (
                {"scheduled": "Scheduled", "forfeit": "Forfeit",
                 "not_played": "Not played"}.get(g["status"]),
                group_names.get((g["season_id"], g["group_id"])),
                when, g["venue"], season_names.get(g["season_id"])) if x)
            write_share("games", eid, title, desc, f"#/games/{eid}")
            n_share += 1

        for tid, (season, _grp) in sorted(team_best.items()):
            t = team_payload(conn, season, tid)
            if not t:
                continue
            title = f"{t['team_name']} — {t['group_name']}"
            desc = " · ".join(x for x in (
                f"{t['gp']} GP {t['wins']}-{t['losses']}",
                f"{t['pts_for']} PF / {t['pts_against']} PA",
                f"roster {len(t['roster'])}",
                season_names.get(season)) if x)
            write_share("teams", tid, title, desc, f"#/teams/{tid}")
            n_share += 1

        for pid, (season, _gp, neg_group) in sorted(player_best.items()):
            group = -neg_group
            p = player_payload(conn, season, pid, group)
            if not p:
                continue
            gp = max(p["gp"], 1)
            title = f"{p['player_name']} — {p['team_name']}"
            desc = " · ".join(x for x in (
                f"{p['gp']} GP",
                f"{p['pts'] / gp:.1f} PPG", f"{p['reb'] / gp:.1f} RPG",
                f"{p['ast'] / gp:.1f} APG",
                group_names.get((season, group)),
                season_names.get(season)) if x)
            # the season/group suffix is what opens a shared player link in the
            # right context — player ids repeat across seasons (app.js route())
            write_share("players", pid, title, desc,
                        f"#/players/{pid}?season={season}&group={group}")
            n_share += 1

        # One page per season+group. The group is the unit people actually pass
        # around (a group's standings table is what a parent sends to another
        # parent), and unlike games/teams/players it has no id of its own that
        # could stand alone: group ids are reused across seasons with different
        # meanings, so the season has to be in the path.
        for season, group in combo_keys:
            gname = group_names.get((season, group), f"Group {group}")
            rows = standings_rows(conn, season, group)
            # same order as the page a recipient lands on (points first, official
            # listing order as the tiebreak), so the card agrees with the page
            top = " · ".join(f"{r['pos']}. {r['team_name']} {r['wins']}-{r['losses']}"
                             for r in rows[:3])
            title = f"{gname} · Season {season} standings"
            desc = " · ".join(x for x in (top, f"{len(rows)} teams",
                                          season_names.get(season)) if x)
            write_share("groups", f"{season}/{group}", title, desc,
                        f"#/standings?season={season}&group={group}")
            n_share += 1

        # One page per season: the overview that lists its groups. Deliberately
        # small — a season card says how big the season is, not every table.
        for _s in mp["seasons"]:
            sp = season_payload(conn, _s["season_id"])
            t = sp["totals"]
            desc = " · ".join(x for x in (
                f"{t['groups']} groups", f"{t['teams']} teams",
                f"{t['games']} games ({t['played']} played)",
                f"data through {t['last_game']}" if t["last_game"] else None) if x)
            write_share("seasons", _s["season_id"], sp["season_name"], desc,
                        f"#/season/{_s['season_id']}")
            n_share += 1

        # tell GitHub Pages not to run Jekyll over the site
        with open(os.path.join(out_dir, ".nojekyll"), "w") as f:
            f.write("")
        # GitHub Pages caches assets for 10 min (max-age=600), so version every
        # asset URL with a build stamp. Vite is configured to emit stable asset
        # names (vite.config.js) instead of content hashes, which lets the stamp
        # be the single cache key — exactly like the vanilla app.js?v= scheme.
        # The stamp is derived from the actual data, the app sources, the data
        # bundle and server.py, so a re-export with no change is byte-identical
        # while any refresh/code change bumps every URL.
        import hashlib
        sig_parts = [tuple(r) for r in conn.execute("""
            SELECT g.event_id, g.status, g.home_score, g.away_score,
                   (SELECT COUNT(*) FROM player_game_stats p WHERE p.event_id = g.event_id)
            FROM games g ORDER BY g.event_id""")]
        sig_src = _react_source_signature()
        with open(os.path.join(out_dir, "league-data.js"), "rb") as f:
            sig_src += "league-data.js:" + hashlib.md5(f.read()).hexdigest() + ";"
        with open(os.path.abspath(__file__), "rb") as f:
            sig_src += "server.py:" + hashlib.md5(f.read()).hexdigest() + ";"
        stamp = hashlib.md5(
            (str(sig_parts) + "|" + (mp.get("refreshed_at") or "") + sig_src).encode()
        ).hexdigest()[:12]
        idx = os.path.join(out_dir, "index.html")
        with open(idx, encoding="utf-8") as f:
            html = f.read()
        # The site runs under a subpath on GitHub Pages (/hillen-league/), so every
        # URL must be relative. Vite rewrites `./league-data.js` only when the file
        # exists in public/ — a CI checkout has no data snapshot there (it is
        # generated, and git-ignored), so force the relative form server-side
        # instead of depending on that.
        html = html.replace('src="/league-data.js', 'src="./league-data.js')
        # ./assets/… (JS + CSS), the loader script, and any fonts/images Vite emitted
        html = re.sub(r'(\./assets/[^"\'?#\s]+)', lambda m: m.group(1) + "?v=" + stamp, html)
        html = re.sub(r'((?:\./|/)?league-data\.js)("|,)',
                      lambda m: m.group(1) + "?v=" + stamp + m.group(2), html, count=1)
        with open(idx, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"exported static site to {out_dir}/ (build {stamp})")
        print(f"  app: React dashboard (react-dashboard/) · data bundle {bundle_size / 1e6:.2f} MB")
        print(f"  combos: {combos}")
        print(f"  teams: {n_teams} · players: {n_players} · games: {n_games}")
        print(f"  share pages: {n_share} (per game/team/player + one per season+group)")
    finally:
        conn.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "HillenDash/1.0"

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _conn(self):
        conn = sqlite3.connect(self.server.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        qs = urllib.parse.parse_qs(parsed.query)
        get = lambda k, d=None: (qs.get(k) or [d])[0]  # noqa: E731

        if path.startswith("/api/"):
            self._api(path, get)
            return

        # Share links (/games/20863/, /teams/1595/, /players/15376/,
        # /groups/33/11/) are real files in the export, written by export_static.
        # In dev there are none, so a link copied by the 🔗 button would 404 — send
        # it to the equivalent hash route instead. A local copy can't be previewed
        # by a chat app anyway.
        m = re.fullmatch(r"/(games|teams|players)/(\d+)/?", path)
        if m:
            self.send_response(302)
            self.send_header("Location", f"/#/{m.group(1)}/{m.group(2)}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        # A group page is just that group's standings, so it needs the season and
        # group as context — they are the one route that carries them in the URL.
        m = re.fullmatch(r"/groups/(\d+)/(\d+)/?", path)
        if m:
            self.send_response(302)
            self.send_header(
                "Location", f"/#/standings?season={m.group(1)}&group={m.group(2)}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        # A season page lists its groups.
        m = re.fullmatch(r"/seasons/(\d+)/?", path)
        if m:
            self.send_response(302)
            self.send_header("Location", f"/#/season/{m.group(1)}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        # static files
        rel = path.lstrip("/") or "index.html"
        if not rel or rel.startswith("..") or "\\" in rel:
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        fp = os.path.realpath(os.path.join(STATIC_DIR, rel))
        if not fp.startswith(os.path.realpath(STATIC_DIR)):
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        if not os.path.isfile(fp):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        # version asset URLs by file mtime so browsers never cache stale JS/CSS
        if os.path.basename(fp) == "index.html":
            with open(fp, encoding="utf-8") as f:
                html = f.read()
            def _v(m):
                asset = m.group(2)
                try:
                    ver = int(os.path.getmtime(os.path.join(STATIC_DIR, asset)))
                except OSError:
                    ver = 1
                return f'{m.group(1)}="{asset}?v={ver}"'
            html = re.sub(r'(src|href)="(app\.js|charts\.js|style\.css)"', _v, html)
            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
        }.get(os.path.splitext(fp)[1].lower(), "application/octet-stream")
        with open(fp, "rb") as f:
            self._send(200, f.read(), ctype)

    def _api(self, path, get):
        season = get("season")
        group = get("group")

        # season/group are integers in SQL. A missing or non-numeric value used
        # to reach int() deep inside a branch and raise TypeError, which the
        # except clause below did not catch — the handler then died mid-request
        # and the client saw a dropped connection (curl reports HTTP 000)
        # instead of a diagnosable error. Validate up front so every endpoint
        # that needs them fails cleanly with a 400 that names the parameter.
        def req_int(v, name):
            if v is None or v == "":
                raise ValueError(f"missing required query parameter: {name}")
            return int(v)

        try:
            conn = self._conn()
            try:
                if path == "/api/meta":
                    self._json(meta_payload(conn, self.server.db_path))
                elif path == "/api/season":
                    self._json(season_payload(conn, req_int(season, "season")))
                elif path == "/api/standings":
                    self._json(standings_rows(conn, req_int(season, "season"), req_int(group, "group")))
                elif path == "/api/teams":
                    self._json(query(conn, "teams", (req_int(season, "season"), req_int(group, "group"))))
                elif re.fullmatch(r"/api/teams/\d+", path):
                    tid = int(path.rsplit("/", 1)[1])
                    payload = team_payload(conn, req_int(season, "season"), tid)
                    if payload is None:
                        self._json({"error": "team not found"}, 404)
                        return
                    self._json(payload)
                elif path == "/api/players":
                    self._json(query(conn, "players", (req_int(season, "season"), req_int(group, "group"))))
                elif re.fullmatch(r"/api/players/\d+", path):
                    pid = int(path.rsplit("/", 1)[1])
                    if group is None:
                        self._json({"error": "player detail requires ?group="}, 400)
                        return
                    payload = player_payload(conn, req_int(season, "season"), pid, req_int(group, "group"))
                    if payload is None:
                        self._json({"error": "player not found"}, 404)
                        return
                    self._json(payload)
                elif path == "/api/games":
                    self._json(query(conn, "games", (req_int(season, "season"), req_int(group, "group"))))
                elif path == "/api/leaders":
                    self._json(query(conn, "leaders", (req_int(season, "season"), req_int(group, "group"))))
                elif re.fullmatch(r"/api/games/\d+", path):
                    eid = int(path.rsplit("/", 1)[1])
                    payload = game_payload(conn, eid)
                    if payload is None:
                        self._json({"error": "game not found"}, 404)
                        return
                    self._json(payload)
                else:
                    self._json({"error": "unknown endpoint"}, 404)
            finally:
                conn.close()
        except (ValueError, TypeError, sqlite3.Error) as e:
            self._json({"error": str(e)}, 400)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


def main():
    ap = argparse.ArgumentParser(description="Hillen League dashboard server / static exporter")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--export", metavar="DIR", nargs="?", const="docs", default=None,
                    help="build and write the static site (React dashboard) into DIR "
                         "and exit — for GitHub Pages (folder /docs) or other static hosts")
    ap.add_argument("--export-data", metavar="FILE", default=None,
                    help="write the React dashboard's inline data bundle "
                         "(window.LEAGUE_DATA) to FILE and exit — used to refresh "
                         "react-dashboard/public/league-data.js for `npm run dev`")
    args = ap.parse_args()

    if args.export_data:
        export_react_data(args.export_data, args.db)
        return

    if args.export:
        export_static(args.export, args.db)
        return

    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    httpd.db_path = args.db
    print(f"Hillen League dashboard: http://127.0.0.1:{args.port}")
    print(f"  db: {args.db}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
