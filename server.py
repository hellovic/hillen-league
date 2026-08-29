#!/usr/bin/env python3
"""
Hillen League dashboard server.

Zero-dependency (stdlib only) HTTP server that:
  * serves the static dashboard from ./dashboard/
  * exposes a read-only JSON API over hillen_league.db

Usage:
    python3 server.py [--port 8000] [--db hillen_league.db]

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
import json
import os
import re
import sqlite3
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(HERE, "dashboard")
DB_PATH = os.path.join(HERE, "hillen_league.db")

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
        WHERE v.season_id = ? AND v.player_id = ?""",
    "player_games": """
        SELECT g.event_id, g.game_date, g.home_team_id, g.away_team_id,
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
        WHERE pgs.player_id = ? AND g.season_id = ?
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
        ORDER BY l.category, l.rank""",
    "seasons": "SELECT season_id, name FROM seasons ORDER BY season_id",
    "groups": """SELECT g.season_id, g.group_id, g.name FROM groups g
                 WHERE EXISTS (SELECT 1 FROM season_teams st
                               WHERE st.season_id = g.season_id AND st.group_id = g.group_id)
                 ORDER BY g.season_id, g.group_id""",
}


def query(conn, key, params=()):
    cur = conn.execute(QUERIES[key], params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


# --------------------------------------------------------------------------
# API payload builders (shared by the live server and the static exporter)
# --------------------------------------------------------------------------

def meta_payload(conn):
    counts = {r["k"]: r["v"] for r in query(conn, "meta")}
    combos = [{"season": s, "group": g} for s, g in
              conn.execute("SELECT DISTINCT season_id, group_id FROM season_teams ORDER BY 1, 2")]
    row = conn.execute(
        "SELECT MIN(game_date), MAX(game_date) FROM games WHERE game_date IS NOT NULL").fetchone()
    return {
        "seasons": query(conn, "seasons"),
        "groups": query(conn, "groups"),
        "combos": combos,
        "counts": counts,
        "min_game_date": row[0],
        "max_game_date": row[1],
        "default_season": 32,
        "default_group": 26,
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


def player_payload(conn, season, pid):
    rows = query(conn, "player_detail", (season, pid))
    if not rows:
        return None
    player = rows[0]
    player["games"] = query(conn, "player_games", (pid, season))
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


def export_static(out_dir, db_path=DB_PATH):
    """Generate a fully static copy of the dashboard (data/*.json + assets)
    that works on any static host (GitHub Pages, Netlify, Cloudflare…)."""
    import shutil

    if os.path.abspath(out_dir) == os.path.abspath(STATIC_DIR):
        raise SystemExit("refusing to export over dashboard/ — pick another dir, e.g. site/")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        data_root = os.path.join(out_dir, "data")
        os.makedirs(data_root, exist_ok=True)
        with open(os.path.join(data_root, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta_payload(conn), f, ensure_ascii=False)

        combos = meta_payload(conn)["combos"]
        n_teams = n_players = n_games = 0
        for combo in combos:
            season, group = combo["season"], combo["group"]
            d = os.path.join(data_root, str(season), str(group))
            teams = query(conn, "teams", (season, group))
            players = query(conn, "players", (season, group))
            games = query(conn, "games", (season, group))
            for name, payload in (("standings.json", query(conn, "standings", (season, group))),
                                  ("teams.json", teams),
                                  ("players.json", players),
                                  ("games.json", games),
                                  ("leaders.json", query(conn, "leaders", (season, group)))):
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, name), "w", encoding="utf-8") as f:
                    json.dump(payload, f, ensure_ascii=False)
            for t in teams:
                p = team_payload(conn, season, t["team_id"])
                os.makedirs(os.path.join(d, "teams"), exist_ok=True)
                with open(os.path.join(d, "teams", f"{t['team_id']}.json"), "w", encoding="utf-8") as f:
                    json.dump(p, f, ensure_ascii=False)
                n_teams += 1
            for pl in players:
                p = player_payload(conn, season, pl["player_id"])
                os.makedirs(os.path.join(d, "players"), exist_ok=True)
                with open(os.path.join(d, "players", f"{pl['player_id']}.json"), "w", encoding="utf-8") as f:
                    json.dump(p, f, ensure_ascii=False)
                n_players += 1
            for g in games:
                p = game_payload(conn, g["event_id"])
                os.makedirs(os.path.join(d, "games"), exist_ok=True)
                with open(os.path.join(d, "games", f"{g['event_id']}.json"), "w", encoding="utf-8") as f:
                    json.dump(p, f, ensure_ascii=False)
                n_games += 1

        for name in os.listdir(STATIC_DIR):
            src = os.path.join(STATIC_DIR, name)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(out_dir, name))
        # tell GitHub Pages not to run Jekyll over the site
        with open(os.path.join(out_dir, ".nojekyll"), "w") as f:
            f.write("")
        # GitHub Pages caches assets for 10 min (max-age=600); version every
        # asset URL with a build stamp so viewers get the new build instantly.
        # The stamp is derived from the actual game data (not the clock), so a
        # re-export with no new data produces an identical index.html instead of
        # a spurious diff/commit.
        import hashlib
        sig_parts = [tuple(r) for r in conn.execute("""
            SELECT g.event_id, g.status, g.home_score, g.away_score,
                   (SELECT COUNT(*) FROM player_game_stats p WHERE p.event_id = g.event_id)
            FROM games g ORDER BY g.event_id""")]
        stamp = hashlib.md5(str(sig_parts).encode()).hexdigest()[:12]
        idx = os.path.join(out_dir, "index.html")
        with open(idx, encoding="utf-8") as f:
            html = f.read()
        html = html.replace('<link rel="stylesheet" href="style.css">',
                            f'<link rel="stylesheet" href="style.css?v={stamp}">')
        html = html.replace('<script src="app.js"></script>',
                            f'<script>window.HL_BUILD="{stamp}";</script>\n'
                            f'<script src="app.js?v={stamp}"></script>')
        with open(idx, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"exported static site to {out_dir}/ (build {stamp})")
        print(f"  combos: {combos}")
        print(f"  teams: {n_teams} · players: {n_players} · games: {n_games}")
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
        try:
            conn = self._conn()
            try:
                if path == "/api/meta":
                    self._json(meta_payload(conn))
                elif path == "/api/standings":
                    self._json(query(conn, "standings", (int(season), int(group))))
                elif path == "/api/teams":
                    self._json(query(conn, "teams", (int(season), int(group))))
                elif re.fullmatch(r"/api/teams/\d+", path):
                    tid = int(path.rsplit("/", 1)[1])
                    payload = team_payload(conn, int(season), tid)
                    if payload is None:
                        self._json({"error": "team not found"}, 404)
                        return
                    self._json(payload)
                elif path == "/api/players":
                    self._json(query(conn, "players", (int(season), int(group))))
                elif re.fullmatch(r"/api/players/\d+", path):
                    pid = int(path.rsplit("/", 1)[1])
                    payload = player_payload(conn, int(season), pid)
                    if payload is None:
                        self._json({"error": "player not found"}, 404)
                        return
                    self._json(payload)
                elif path == "/api/games":
                    self._json(query(conn, "games", (int(season), int(group))))
                elif path == "/api/leaders":
                    self._json(query(conn, "leaders", (int(season), int(group))))
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
        except (ValueError, sqlite3.Error) as e:
            self._json({"error": str(e)}, 400)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


def main():
    ap = argparse.ArgumentParser(description="Hillen League dashboard server / static exporter")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--export", metavar="DIR", nargs="?", const="docs", default=None,
                    help="generate a static copy of the site into DIR (default: docs/) "
                         "and exit — for GitHub Pages (folder /docs) or other static hosts")
    args = ap.parse_args()

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
