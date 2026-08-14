#!/usr/bin/env python3
"""
Hillen League scraper — builds hillen_league.db from hillen-sports.com/hillenyouth.

Focused on one group in one season (default: season 32, group 26 = YOUTH GIRLS U13),
but parameterised so other groups/seasons can be added later.

Data collected per group+season:
  * teams and official standings (division.php)
  * season stat leaderboards, 8 categories (statistics.php)
  * team profiles, rosters, schedules (teams_detail_info.php)
  * every game with quarter scores, team summary, full per-player box scores (scores.php)

Usage:
    python3 scraper.py [--season 32] [--group 26] [--db hillen_league.db] [--refresh]

Stdlib only (urllib, sqlite3, re). Pages are cached under ./cache/ to make
re-runs cheap and idempotent.
"""

import argparse
import os
import re
import sqlite3
import ssl
import time
import urllib.request

BASE = "https://www.hillen-sports.com/hillenyouth/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# hillen-sports.com omits its intermediate certificate; appending the GoDaddy
# G2 intermediate completes the chain (curl succeeds via the macOS keychain,
# plain Python ssl needs the intermediate added explicitly).
GODADDY_G2_URL = "https://certs.godaddy.com/repository/gdig2.crt.pem"

CATEGORY_CN = {
    "MVP": "mvp", "得分王": "pts", "三分王": "fg3", "助攻王": "ast",
    "偷截王": "stl", "罰球王": "ft", "籃板王": "reb", "封阻王": "blk",
}

# box-score column name -> player_game_stats column
STAT_COLS = {
    "DB": "def_reb", "OB": "off_reb", "REB": "tot_reb", "AST": "ast",
    "ST": "stl", "BS": "blk", "FB": "fb", "BA": "ba", "TO": "tov",
    "PF": "pf", "EFF": "eff", "+/-": "plus_minus", "PTS": "pts",
}


# --------------------------------------------------------------------------
# HTTP + cache
# --------------------------------------------------------------------------

class Fetcher:
    def __init__(self, cache_dir, refresh=False, delay=0.4):
        self.cache_dir = cache_dir
        self.refresh = refresh
        self.delay = delay
        os.makedirs(cache_dir, exist_ok=True)
        self.ctx = self._ssl_context()

    def _ssl_context(self):
        """Default context, extended with the GoDaddy G2 intermediate that the
        site fails to send. Falls back to unverified if the intermediate can't
        be fetched (read-only public data only)."""
        ctx = ssl.create_default_context()
        inter = os.path.join(self.cache_dir, "gdig2.crt.pem")
        try:
            if not os.path.exists(inter):
                req = urllib.request.Request(GODADDY_G2_URL, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    with open(inter, "wb") as f:
                        f.write(resp.read())
            ctx.load_verify_locations(cafile=inter)
        except Exception:  # noqa: BLE001
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx

    def _cache_path(self, url):
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", url)
        return os.path.join(self.cache_dir, safe + ".html")

    def get(self, url):
        path = self._cache_path(url)
        if not self.refresh and os.path.exists(path):
            with open(path, encoding="utf-8", errors="replace") as f:
                return f.read()
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": UA,
                    "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
                })
                with urllib.request.urlopen(req, timeout=30, context=self.ctx) as resp:
                    raw = resp.read()
                html = raw.decode("utf-8", errors="replace")
                with open(path, "w", encoding="utf-8") as f:
                    f.write(html)
                time.sleep(self.delay)
                return html
            except Exception:  # noqa: BLE001
                if attempt == 2:
                    raise
                time.sleep(1.5 * (attempt + 1))


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s).replace("&nbsp;", " ").strip()


def extract_div_block(html, start):
    """Return the balanced <div>...</div> block starting at html[start].
    Leading `</div>` closers (containers opened before `start`) are ignored."""
    depth = 0
    started = False
    for m in re.finditer(r"<(/?)div\b[^>]*>", html[start:], re.I):
        if not m.group(1):
            depth += 1
            started = True
        else:
            if depth == 0:
                continue
            depth -= 1
            if depth == 0 and started:
                return html[start:start + m.end()]
    return html[start:]


def tcol_values(block):
    """Ordered values of every t-col div in a block (tags stripped)."""
    return [strip_tags(v) for v in
            re.findall(r'<div class="t-col[^"]*">(.*?)</div>', block, re.S)]


def widget_block_after(html, marker, widget_class):
    """Balanced block of the widget containing the first <h3> with `marker`
    whose div class contains `widget_class`."""
    for m in re.finditer(r"<h3[^>]*>(.*?)</h3>", html, re.S):
        if marker not in strip_tags(m.group(1)):
            continue
        head = html[:m.start()]
        starts = [w.start() for w in
                  re.finditer(r'<div class="widget[^"]*' + re.escape(widget_class) + r'[^"]*">', head)]
        if starts:
            return extract_div_block(html, starts[-1])
    return None


def widget_block_before(html, marker):
    """Balanced block of the nearest '<div class="widget' before the first
    <h3> containing `marker` (used for team-page sections)."""
    for m in re.finditer(r"<h3[^>]*>(.*?)</h3>", html, re.S):
        if marker not in strip_tags(m.group(1)):
            continue
        starts = [w.start() for w in re.finditer(r'<div class="widget', html[:m.start()])]
        if not starts:
            return None
        return extract_div_block(html, starts[-1])
    return None


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# parsers
# --------------------------------------------------------------------------

def parse_division_teams(html):
    """Teams from division.php?group_id=.. main card list."""
    m = re.search(r'<div class="widget kopa-entry-list division-teams">(.*?)</div>\s*<!-- widget -->',
                  html, re.S)
    if not m:
        return []
    return [(int(t), n.strip()) for t, n in
            re.findall(r'teams_detail_info\.php\?season_id=\d+&team_id=(\d+)">([^<]+)<', m.group(1))]


def parse_standings(html, group_name):
    """Standings table (分組表) for one group from division.php."""
    out = []
    for m in re.finditer(r'<h3 class="element-title"><span class="myfont">([^<]*分組表)</span>', html):
        if group_name not in m.group(1):
            continue
        block = extract_div_block(html, m.start())
        rows = re.findall(r"<li>(.*?)</li>", block, re.S)
        for rank, r in enumerate(rows, start=1):
            vals = tcol_values(r)
            tm = re.search(r"team_id=(\d+)", r)
            if not tm or len(vals) < 7:
                continue
            diff = vals[5]
            out.append({
                "team_id": int(tm.group(1)), "rank": rank,
                "gp": to_int(vals[1]), "wins": to_int(vals[2]),
                "losses": to_int(vals[3]), "forfeits": to_int(vals[4]),
                "diff": None if diff in ("", " ") else to_int(diff),
                "points": to_int(vals[6]),
            })
    # dedupe (page renders desktop + mobile copies)
    seen, uniq = set(), []
    for r in out:
        if r["team_id"] in seen:
            continue
        seen.add(r["team_id"])
        uniq.append(r)
    return uniq


def parse_leaderboards(html):
    """8 leaderboards from statistics.php?group_id=.."""
    out = []
    main = html[html.find("statistics-table"):]
    cats = re.split(r'<h3 class="element-title"><span class="myfont">([^<]+)</span>', main)
    for i in range(1, len(cats), 2):
        cn, body = cats[i], cats[i + 1]
        key = CATEGORY_CN.get(cn)
        if key is None:
            continue
        for rank, r in enumerate(re.findall(r"<li>(.*?)</li>", body, re.S), start=1):
            vals = [v for v in tcol_values(r) if v]
            if len(vals) < 5:
                continue
            pid = re.search(r"player_id=(\d+)", r)
            tid = re.search(r"team_id=(\d+)", r)
            if not pid or not tid:
                continue
            out.append({
                "category": key, "category_cn": cn, "rank": rank,
                "player_id": int(pid.group(1)), "team_id": int(tid.group(1)),
                "player_name": vals[0], "team_name": vals[1],
                "games": to_int(vals[2]), "total": to_float(vals[3]), "avg": to_float(vals[4]),
            })
    return out


def parse_schedule_season(html, group_label):
    """Events from schedule.php?season_id=.. filtered by group label."""
    out = []
    for b in re.split(r"<li>\s*<div class=\"match-item", html)[1:]:
        sp = re.search(r"<span>([^<]+)</span>", b)
        if not sp or sp.group(1) != group_label:
            continue
        ev = re.search(r"event_id=(\d+)", b)
        if not ev:
            continue
        dt = re.search(r"<p>(\d{4}-\d{2}-\d{2}) ([^<]+?) - ([^<]+?)</p>", b)
        out.append({
            "event_id": int(ev.group(1)),
            "date": dt.group(1) if dt else None,
            "start": dt.group(2) if dt else None,
            "end": dt.group(3) if dt else None,
        })
    return out


def parse_team_page(html, season_id, team_id):
    """Profile, roster, schedule from teams_detail_info.php"""
    profile = {"season_id": season_id, "team_id": team_id}

    pm = re.search(r'<div class="player-profile">(.*?)</ul>', html, re.S)
    if pm:
        for label, raw in re.findall(r'<div class="p-left">([^<]+)</div>\s*<div class="p-right">(.*?)</div>',
                                     pm.group(1), re.S):
            val = strip_tags(raw)
            if label == "領隊":
                profile["manager"] = val
            elif label == "隊長":
                pid = re.search(r"player_id=(\d+)", raw)
                profile["captain_player_id"] = int(pid.group(1)) if pid else None
            elif label == "主場顏色":
                profile["home_color"] = val
            elif label == "作客顏色":
                profile["away_color"] = val
            elif label == "本季總得分":
                profile["season_pts_for"] = to_int(val)
            elif label == "本季總失分":
                profile["season_pts_against"] = to_int(val)

    # roster (隊員名單)
    roster = []
    rm = widget_block_before(html, "隊員名單")
    if rm:
        for r in re.findall(r"<li>(.*?)</li>", rm, re.S):
            vals = tcol_values(r)
            pid = re.search(r"player_id=(\d+)", r)
            if pid and vals:
                roster.append({
                    "player_id": int(pid.group(1)),
                    "name": re.sub(r"\s*\(\d+\)\s*$", "", vals[0]),
                    "jersey_no": to_int(vals[1]) if len(vals) > 1 else None,
                })

    # schedule (賽程)
    schedule = []
    sm = widget_block_before(html, "賽程")
    if sm:
        for b in re.split(r"<li>\s*<div class=\"match-item", sm)[1:]:
            ev = re.search(r"event_id=(\d+)", b)
            if not ev:
                continue
            dt = re.search(r"<p>(\d{4}-\d{2}-\d{2}) ([^<]+?) - ([^<]+?)</p>", b)
            left = re.search(r'r-side left" href="[^"]*team_id=(\d+)"', b)
            right = re.search(r'r-side right" href="[^"]*team_id=(\d+)"', b)
            nums = re.findall(r'<span class="[^"]*">(\d+)</span>\s*<span>-</span>\s*<span class="[^"]*">(\d+)</span>', b)
            schedule.append({
                "event_id": int(ev.group(1)),
                "date": dt.group(1) if dt else None,
                "start": dt.group(2) if dt else None,
                "end": dt.group(3) if dt else None,
                "home_team_id": int(left.group(1)) if left else None,
                "away_team_id": int(right.group(1)) if right else None,
                "home_score": int(nums[0][0]) if nums else None,
                "away_score": int(nums[0][1]) if nums else None,
            })
    return profile, roster, schedule


def parse_scores_page(html, season_id, event_id):
    """Full game info + box scores from scores.php"""
    out = {"event_id": event_id, "season_id": season_id, "home_team_id": None,
           "away_team_id": None, "home_score": None, "away_score": None,
           "date": None, "start": None, "end": None, "group_name": None,
           "venue": None, "status": "scheduled",
           "quarters": [], "team_stats": [], "box": []}

    hm = re.search(r'<div class="match-item list-item style10 completed-item">'
                   r'(.*?)(?:<div class="match-info">|<div class="widget kopa-charts-widget section-scores">)',
                   html, re.S)
    if not hm:
        return out
    hdr = hm.group(1)
    dt = re.search(r"<p>(\d{4}-\d{2}-\d{2}) ([^<]+?) - ([^<]+?)</p>", hdr)
    if dt:
        out["date"], out["start"], out["end"] = dt.group(1), dt.group(2), dt.group(3)
    sp = re.search(r"<span>([^<]+)</span>", hdr)
    if sp:
        out["group_name"] = sp.group(1)
    nums = re.search(r'<a class="r-num"[^>]*>(.*?)</a>', hdr, re.S)
    if nums:
        scores = [int(x) for x in re.findall(r'<span class="[^"]*">(\d+)</span>', nums.group(1))]
        if len(scores) >= 2:
            out["home_score"], out["away_score"] = scores[0], scores[1]
            out["status"] = "completed"
    side_info = {}
    for side, tid, body in re.findall(r'r-side (left|right)" href="[^"]*team_id=(\d+)"[^>]*>(.*?)</a>',
                                      hdr, re.S):
        color = re.search(r"team-color-text\">\(([^)]*)\)", body)
        name = re.search(r"<h5>.*?&nbsp;</span>([^<]+)</h5>", body, re.S)
        side_info[side] = {"team_id": int(tid),
                           "color": color.group(1) if color else None,
                           "name": name.group(1).strip() if name else None}
    if "left" in side_info:
        out["home_team_id"] = side_info["left"]["team_id"]
    if "right" in side_info:
        out["away_team_id"] = side_info["right"]["team_id"]

    mi = re.search(r'<div class="match-info">(.*?)</div>', html, re.S)
    if mi:
        vm = re.search(r'fa-map-marker"></i>([^<]+)</p>', mi.group(1))
        if vm:
            out["venue"] = vm.group(1).strip()

    # quarter scores
    qm = re.search(r'class="widget kopa-charts-widget section-scores">(.*?)</div>\s*</div>', html, re.S)
    if qm:
        for r in re.findall(r"<li>(.*?)</li>", qm.group(1), re.S):
            vals = tcol_values(r)
            tm = re.search(r"team_id=(\d+)", r)
            if tm and len(vals) >= 6:
                q = {"team_id": int(tm.group(1)),
                     "q1": to_int(vals[1]), "q2": to_int(vals[2]),
                     "q3": to_int(vals[3]), "q4": to_int(vals[4]),
                     "ot": to_int(vals[5])}
                if any(q[k] is not None for k in ("q1", "q2", "q3", "q4", "ot")):
                    out["quarters"].append(q)

    # team performance (失誤/籃板/快攻) + shirt colours
    pm = re.search(r'class="widget kopa-charts-widget performance-count">(.*?)</div>\s*</div>', html, re.S)
    if pm:
        for r in re.findall(r"<li>(.*?)</li>", pm.group(1), re.S):
            vals = tcol_values(r)
            tm = re.search(r"team_id=(\d+)", r)
            if tm and len(vals) >= 4:
                ts = {"team_id": int(tm.group(1)),
                      "turnovers": to_int(vals[1]), "rebounds": to_int(vals[2]),
                      "fastbreaks": to_int(vals[3])}
                if any(ts[k] is not None for k in ("turnovers", "rebounds", "fastbreaks")):
                    color = next((s["color"] for s in side_info.values()
                                  if s["team_id"] == ts["team_id"]), None)
                    ts["shirt_color"] = color
                    out["team_stats"].append(ts)

    # per-player box scores (主隊/客隊總計數據 widgets)
    for label, team_key in (("主隊總計數據", "home_team_id"), ("客隊總計數據", "away_team_id")):
        wid = widget_block_after(html, label, "player_stats")
        if not wid:
            continue
        team_id = out[team_key]
        header = re.search(r"<header>(.*?)</header>", wid, re.S)
        cols = tcol_values(header.group(1)) if header else []
        if not cols or cols[0] != "No":
            continue
        for r in re.findall(r"<li>(.*?)</li>", wid, re.S):
            vals = tcol_values(r)
            pid = re.search(r"player_id=(\d+)", r)
            if not pid or len(vals) != len(cols):
                continue
            rec = {"event_id": event_id, "player_id": int(pid.group(1)), "team_id": team_id}
            for i, col in enumerate(cols):
                v = vals[i]
                if col == "No":
                    rec["jersey_no"] = to_int(v)
                elif col == "Name":
                    rec["name"] = re.sub(r"\s*\(\d+\)\s*$", "", v)
                elif col == "Min":
                    rec["minutes"] = v
                elif col in ("2PT", "3PT", "FG", "FT"):
                    if "-" in v:
                        mm, aa = v.split("-")
                        rec[f"{col}_m"] = to_int(mm)
                        rec[f"{col}_a"] = to_int(aa)
                    if i + 1 < len(cols) and cols[i + 1] == "%":
                        rec[f"{col}_pct"] = to_float(vals[i + 1])
                elif col in STAT_COLS:
                    rec[STAT_COLS[col]] = to_int(v) if v not in ("", "-") else None
            out["box"].append(rec)
    # a 0-0 game with no quarter data / box scores was never played (e.g. walkover)
    if out["status"] == "completed" and not out["box"] and not out["quarters"]:
        out["status"] = "not_played"
        out["home_score"] = out["away_score"] = None
    return out


# --------------------------------------------------------------------------
# DB
# --------------------------------------------------------------------------

class Store:
    def __init__(self, db_path):
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("PRAGMA foreign_keys = ON")
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "schema.sql"), encoding="utf-8") as f:
            self.conn.executescript(f.read())
        self.conn.commit()

    def commit(self):
        self.conn.commit()

    def upsert_season(self, season_id, name):
        self.conn.execute("INSERT INTO seasons(season_id, name) VALUES(?,?) "
                          "ON CONFLICT(season_id) DO UPDATE SET name=excluded.name", (season_id, name))

    def upsert_group(self, group_id, name):
        self.conn.execute("INSERT INTO groups(group_id, name) VALUES(?,?) "
                          "ON CONFLICT(group_id) DO UPDATE SET name=excluded.name", (group_id, name))

    def upsert_team(self, team_id, name):
        self.conn.execute("INSERT INTO teams(team_id, name) VALUES(?,?) "
                          "ON CONFLICT(team_id) DO UPDATE SET name=excluded.name", (team_id, name))

    def upsert_player(self, player_id, name):
        self.conn.execute("INSERT INTO players(player_id, name) VALUES(?,?) "
                          "ON CONFLICT(player_id) DO UPDATE SET name=excluded.name", (player_id, name))

    def upsert_season_team(self, rec):
        cols = ["season_id", "team_id", "group_id", "manager", "captain_player_id",
                "home_color", "away_color", "season_pts_for", "season_pts_against"]
        vals = [rec.get(c) for c in cols]
        sets = ",".join(f"{c}=excluded.{c}" for c in cols[3:])
        self.conn.execute(
            f"INSERT INTO season_teams({','.join(cols)}) VALUES({','.join('?' * len(cols))}) "
            f"ON CONFLICT(season_id, team_id) DO UPDATE SET {sets}", vals)

    def upsert_standings(self, rec):
        self.conn.execute(
            "INSERT INTO standings(season_id, group_id, team_id, rank, gp, wins, losses, forfeits, diff, points) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(season_id, group_id, team_id) DO UPDATE SET "
            "rank=excluded.rank, gp=excluded.gp, wins=excluded.wins, losses=excluded.losses, "
            "forfeits=excluded.forfeits, diff=excluded.diff, points=excluded.points",
            (rec["season_id"], rec["group_id"], rec["team_id"], rec["rank"], rec["gp"],
             rec["wins"], rec["losses"], rec["forfeits"], rec["diff"], rec["points"]))

    def upsert_roster(self, rec):
        self.conn.execute(
            "INSERT INTO rosters(season_id, team_id, player_id, jersey_no) VALUES(?,?,?,?) "
            "ON CONFLICT(season_id, team_id, player_id) DO UPDATE SET jersey_no=excluded.jersey_no",
            (rec["season_id"], rec["team_id"], rec["player_id"], rec.get("jersey_no")))

    def upsert_game(self, rec):
        self.conn.execute(
            "INSERT INTO games(event_id, season_id, group_id, game_date, start_time, end_time, venue, "
            "home_team_id, away_team_id, home_score, away_score, status) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(event_id) DO UPDATE SET "
            "group_id=excluded.group_id, game_date=excluded.game_date, start_time=excluded.start_time, "
            "end_time=excluded.end_time, venue=excluded.venue, home_team_id=excluded.home_team_id, "
            "away_team_id=excluded.away_team_id, home_score=excluded.home_score, "
            "away_score=excluded.away_score, status=excluded.status",
            (rec["event_id"], rec["season_id"], rec["group_id"], rec["date"], rec["start"], rec["end"],
             rec.get("venue"), rec["home_team_id"], rec["away_team_id"], rec["home_score"],
             rec["away_score"], rec["status"]))

    def upsert_quarters(self, rec):
        self.conn.execute(
            "INSERT INTO game_quarters(event_id, team_id, q1, q2, q3, q4, ot) VALUES(?,?,?,?,?,?,?) "
            "ON CONFLICT(event_id, team_id) DO UPDATE SET q1=excluded.q1, q2=excluded.q2, "
            "q3=excluded.q3, q4=excluded.q4, ot=excluded.ot",
            (rec["event_id"], rec["team_id"], rec["q1"], rec["q2"], rec["q3"], rec["q4"], rec["ot"]))

    def upsert_team_stats(self, rec):
        self.conn.execute(
            "INSERT INTO game_team_stats(event_id, team_id, shirt_color, turnovers, rebounds, fastbreaks) "
            "VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(event_id, team_id) DO UPDATE SET shirt_color=excluded.shirt_color, "
            "turnovers=excluded.turnovers, rebounds=excluded.rebounds, fastbreaks=excluded.fastbreaks",
            (rec["event_id"], rec["team_id"], rec.get("shirt_color"),
             rec.get("turnovers"), rec.get("rebounds"), rec.get("fastbreaks")))

    def upsert_box(self, rec):
        self.conn.execute(
            "INSERT INTO player_game_stats(event_id, player_id, team_id, jersey_no, minutes, "
            "fg2m, fg2a, fg2_pct, fg3m, fg3a, fg3_pct, fgm, fga, fg_pct, ftm, fta, ft_pct, "
            "off_reb, def_reb, tot_reb, ast, stl, blk, fb, ba, tov, pf, eff, plus_minus, pts) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(event_id, player_id) DO UPDATE SET "
            "team_id=excluded.team_id, jersey_no=excluded.jersey_no, minutes=excluded.minutes, "
            "fg2m=excluded.fg2m, fg2a=excluded.fg2a, fg2_pct=excluded.fg2_pct, "
            "fg3m=excluded.fg3m, fg3a=excluded.fg3a, fg3_pct=excluded.fg3_pct, "
            "fgm=excluded.fgm, fga=excluded.fga, fg_pct=excluded.fg_pct, "
            "ftm=excluded.ftm, fta=excluded.fta, ft_pct=excluded.ft_pct, "
            "off_reb=excluded.off_reb, def_reb=excluded.def_reb, tot_reb=excluded.tot_reb, "
            "ast=excluded.ast, stl=excluded.stl, blk=excluded.blk, fb=excluded.fb, ba=excluded.ba, "
            "tov=excluded.tov, pf=excluded.pf, eff=excluded.eff, plus_minus=excluded.plus_minus, "
            "pts=excluded.pts",
            (rec["event_id"], rec["player_id"], rec["team_id"], rec.get("jersey_no"), rec.get("minutes"),
             rec.get("2PT_m"), rec.get("2PT_a"), rec.get("2PT_pct"), rec.get("3PT_m"), rec.get("3PT_a"),
             rec.get("3PT_pct"), rec.get("FG_m"), rec.get("FG_a"), rec.get("FG_pct"),
             rec.get("FT_m"), rec.get("FT_a"), rec.get("FT_pct"),
             rec.get("off_reb"), rec.get("def_reb"), rec.get("tot_reb"),
             rec.get("ast"), rec.get("stl"), rec.get("blk"), rec.get("fb"), rec.get("ba"),
             rec.get("tov"), rec.get("pf"), rec.get("eff"), rec.get("plus_minus"), rec.get("pts")))

    def upsert_leaderboard(self, rec):
        self.conn.execute(
            "INSERT INTO stat_leaderboards(season_id, group_id, category, category_cn, rank, "
            "player_id, team_id, games_played, total, avg) VALUES(?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(season_id, group_id, category, rank) DO UPDATE SET "
            "player_id=excluded.player_id, team_id=excluded.team_id, games_played=excluded.games_played, "
            "total=excluded.total, avg=excluded.avg",
            (rec["season_id"], rec["group_id"], rec["category"], rec["category_cn"], rec["rank"],
             rec["player_id"], rec["team_id"], rec["games"], rec["total"], rec["avg"]))


# --------------------------------------------------------------------------
# pipeline
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Hillen League scraper")
    ap.add_argument("--season", type=int, default=32)
    ap.add_argument("--group", type=int, default=26)
    ap.add_argument("--db", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "hillen_league.db"))
    ap.add_argument("--refresh", action="store_true", help="refetch pages, ignoring cache")
    args = ap.parse_args()

    season_id, group_id = args.season, args.group
    here = os.path.dirname(os.path.abspath(__file__))
    cache = Fetcher(os.path.join(here, "cache"), refresh=args.refresh)
    store = Store(args.db)
    log = print

    div = cache.get(f"{BASE}division.php?group_id={group_id}")
    m = re.search(r'<h3 class="widget-title style12"><span class="myfont"[^>]*>([^<]+)</span>', div)
    group_name = m.group(1).strip() if m else f"group {group_id}"
    season_name = f"第{season_id}屆驍籃青少年籃球聯賽"
    store.upsert_season(season_id, season_name)
    store.upsert_group(group_id, group_name)
    log(f"group: {group_name} (id={group_id}), season: {season_name} (id={season_id})")

    # 1. teams
    teams = parse_division_teams(div)
    log(f"teams: {len(teams)}")
    for tid, name in teams:
        store.upsert_team(tid, name)
        store.upsert_season_team({"season_id": season_id, "team_id": tid, "group_id": group_id})

    # 2. standings
    standings = parse_standings(cache.get(f"{BASE}division.php"), group_name)
    log(f"standings: {len(standings)}")
    for s in standings:
        store.upsert_standings({**s, "season_id": season_id, "group_id": group_id})

    # 3. leaderboards
    boards = parse_leaderboards(cache.get(f"{BASE}statistics.php?group_id={group_id}"))
    log(f"leaderboard rows: {len(boards)}")
    for b in boards:
        store.upsert_player(b["player_id"], b["player_name"])
        store.upsert_team(b["team_id"], b["team_name"])
        store.upsert_leaderboard({**b, "season_id": season_id, "group_id": group_id})

    # 4. events from season schedule
    events = parse_schedule_season(cache.get(f"{BASE}schedule.php?season_id={season_id}"), group_name)
    log(f"events from season schedule: {len(events)}")

    # 5. team pages: profile, roster, schedule
    team_events = set()
    group_team_ids = {t for t, _ in teams}
    for tid, name in teams:
        log(f"  team {tid} ({name})...")
        th = cache.get(f"{BASE}teams_detail_info.php?season_id={season_id}&team_id={tid}")
        profile, roster, sched = parse_team_page(th, season_id, tid)
        profile["group_id"] = group_id
        # captain may not be in the players table yet; insert placeholder first
        if profile.get("captain_player_id"):
            store.upsert_player(profile["captain_player_id"], "")
        store.upsert_season_team(profile)
        for r in roster:
            store.upsert_player(r["player_id"], r["name"])
            store.upsert_roster({**r, "season_id": season_id, "team_id": tid})
        for si in sched:
            team_events.add(si["event_id"])
            if (si["home_team_id"] in group_team_ids and si["away_team_id"] in group_team_ids):
                store.upsert_game({**si, "season_id": season_id, "group_id": group_id,
                                   "status": "completed" if si["home_score"] is not None else "scheduled"})
    log(f"events from team schedules: {len(team_events)}")

    all_events = sorted({e["event_id"] for e in events} | team_events)
    log(f"total events: {len(all_events)} -> {all_events}")

    # 6. box scores
    for eid in all_events:
        log(f"  event {eid}...")
        g = parse_scores_page(cache.get(f"{BASE}scores.php?season_id={season_id}&event_id={eid}"),
                              season_id, eid)
        if g["home_team_id"] is None:
            log(f"    !! no team info parsed, skipping")
            continue
        g["group_id"] = group_id
        store.upsert_game(g)
        for q in g["quarters"]:
            store.upsert_quarters({**q, "event_id": eid})
        for ts in g["team_stats"]:
            store.upsert_team_stats({**ts, "event_id": eid})
        for rec in g["box"]:
            store.upsert_player(rec["player_id"], rec["name"])
            store.upsert_box(rec)
        store.commit()

    store.commit()
    log("done.")


if __name__ == "__main__":
    main()
