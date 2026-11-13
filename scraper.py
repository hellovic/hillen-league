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

from collections import Counter, OrderedDict
import argparse
from contextlib import closing
import datetime
import gzip
import http.client
from email.utils import parsedate_to_datetime
import json
import os
import re
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse

BASE = "https://www.hillen-sports.com/hillenyouth/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# hillen-sports.com omits its intermediate certificate; appending the GoDaddy
# G2 intermediate completes the chain (curl succeeds via the macOS keychain,
# plain Python ssl needs the intermediate added explicitly).
GODADDY_G2_URL = "https://certs.godaddy.com/repository/gdig2.crt.pem"
TEAM_PAGE_MAX_AGE = 24 * 3600

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
        self.responses = OrderedDict()
        self.seen_urls = set()
        self.requests = 0
        self.requests_by_page = Counter()
        self.connections = {}
        self.network_bytes = 0
        self.handshakes = 0
        self.cache_hits = 0
        self.memory_hits = 0
        self.revalidations = 0
        self.retries = 0
        self.observations = []

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

    def _remember(self, url, html):
        self.seen_urls.add(url)
        self.responses[url] = html
        if len(self.responses) > 32:
            self.responses.popitem(last=False)
        return html

    def close(self):
        for connection in self.connections.values():
            connection.close()
        self.connections.clear()

    def _request(self, url, headers):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https":
            raise ScrapeError("Only HTTPS source URLs are supported")
        key = (parsed.hostname, parsed.port or 443)
        connection = self.connections.get(key)
        if connection is None:
            connection = http.client.HTTPSConnection(*key, timeout=30, context=self.ctx)
            self.connections[key] = connection
        if connection.sock is None:
            self.handshakes += 1
        self.requests += 1
        self.requests_by_page[parsed.path.rsplit("/", 1)[-1]] += 1
        started = time.perf_counter()
        try:
            connection.request("GET", urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, "")), headers=headers)
            response = connection.getresponse()
            raw = response.read()
            self.network_bytes += len(raw)
            self.observations.append({"url": url, "status": response.status,
                                      "bytes": len(raw), "seconds": time.perf_counter() - started})
            if response.will_close:
                connection.close()
            return response.status, response.headers, raw
        except Exception:
            connection.close()
            raise

    def get(self, url, max_age=None):
        # Explicit clearing starts a new validation pass. Bounded eviction
        # leaves entries in the cache and retains once-per-pass URL reuse.
        if not self.responses:
            self.seen_urls.clear()
        if url in self.responses:
            self.memory_hits += 1
            return self.responses[url]
        path = self._cache_path(url)
        if url in self.seen_urls:
            self.memory_hits += 1
            with open(path, encoding="utf-8") as f:
                return self._remember(url, f.read())
        if os.path.exists(path) and (not self.refresh or (
                max_age is not None and time.time() - os.path.getmtime(path) < max_age)):
            with open(path, encoding="utf-8", errors="replace") as f:
                self._remember(url, f.read())
            self.cache_hits += 1
            return self.responses[url]
        validators = {}
        if os.path.exists(path):
            try:
                with open(path + ".http.json", encoding="utf-8") as f:
                    validators = json.load(f)
            except (OSError, ValueError):
                pass
        for attempt in range(3):
            try:
                headers = {"User-Agent": UA, "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
                           "Accept-Encoding": "gzip"}
                if validators.get("etag"):
                    headers["If-None-Match"] = validators["etag"]
                if validators.get("last_modified"):
                    headers["If-Modified-Since"] = validators["last_modified"]
                status, response_headers, raw = self._request(url, headers)
                if status in (301, 302, 303, 307, 308):
                    # Do not silently scrape a generic home/login/error page.
                    raise ScrapeError(f"Unexpected source redirect ({status}): {url}")
                if status == 304:
                    with open(path, encoding="utf-8") as f:
                        html = f.read()
                    os.utime(path, None)
                    self.revalidations += 1
                elif status == 200:
                    decoded = gzip.decompress(raw) if response_headers.get("Content-Encoding", "").lower() == "gzip" else raw
                    html = decoded.decode("utf-8", errors="replace")
                    require_page(html, url)
                    fd, tmp = tempfile.mkstemp(dir=self.cache_dir)
                    try:
                        with os.fdopen(fd, "w", encoding="utf-8") as f:
                            f.write(html)
                        os.replace(tmp, path)
                    finally:
                        if os.path.exists(tmp):
                            os.unlink(tmp)
                    with open(path + ".http.json", "w", encoding="utf-8") as f:
                        json.dump({"etag": response_headers.get("ETag"),
                                   "last_modified": response_headers.get("Last-Modified")}, f)
                else:
                    if status in (429, 503):
                        retry = response_headers.get("Retry-After")
                        try:
                            delay = float(retry)
                        except (TypeError, ValueError):
                            try:
                                delay = parsedate_to_datetime(retry).timestamp() - time.time()
                            except (TypeError, ValueError, OverflowError):
                                delay = 5 * (attempt + 1)
                        if attempt == 2 or delay > 60:
                            raise ScrapeError(f"Source busy ({status}); retry later: {url}")
                        self.close()
                        self.retries += 1
                        time.sleep(max(self.delay, delay))
                        continue
                    if status < 500:
                        raise ScrapeError(f"Source HTTP {status}: {url}")
                    raise OSError(f"Source HTTP {status}: {url}")
                self._remember(url, html)
                time.sleep(self.delay)
                return html
            except ScrapeError:
                # Invalid pages/4xx responses cannot improve through rapid retries.
                raise
            except Exception:
                self.close()
                if attempt == 2:
                    raise
                self.retries += 1
                time.sleep(max(self.delay, 1.5 * (attempt + 1)))

    def metrics(self):
        return {"requests": self.requests, "network_bytes": self.network_bytes,
                "handshakes": self.handshakes, "cache_hits": self.cache_hits,
                "memory_hits": self.memory_hits, "revalidations": self.revalidations,
                "retries": self.retries, "unique_pages": len(self.seen_urls),
                "requests_by_page": dict(sorted(self.requests_by_page.items())),
                "responses": self.observations}


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
        if re.sub(r"\s+", " ", m.group(1).removesuffix("分組表")).strip() != re.sub(r"\s+", " ", group_name).strip():
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


# The schedule listing reuses the map-marker icon for a live fixture's status
# ("進行中" = in progress), so these values are never a court name.
VENUE_STATUS_LABELS = {"進行中", "已完場", "已完成", "取消", "延期", "待定"}


def match_venue(block):
    """Court name from one fixture block.

    Listings (schedule.php, a team page) wrap it in
    `<a class="match-info"><p><i class="fa fa-map-marker"></i>…`, while a played
    game's scores.php page uses a `<div class="match-info">`. Both are handled.

    A live fixture puts its status in that space instead of a court ("進行中",
    in progress), so a known status label is not mistaken for a venue.
    """
    m = (re.search(r'<a class="match-info"[^>]*>\s*<p><i class="fa fa-map-marker"></i>([^<]+)</p>', block)
         or re.search(r'fa-map-marker"></i>([^<]+)</p>', block))
    if not m:
        return None
    name = m.group(1).strip()
    return None if name in VENUE_STATUS_LABELS else name


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
        left = re.search(r'r-side left" href="[^"]*team_id=(\d+)"', b)
        right = re.search(r'r-side right" href="[^"]*team_id=(\d+)"', b)
        nums = re.findall(r'<span class="[^"]*">(\d+)</span>\s*<span>-</span>\s*<span class="[^"]*">(\d+)</span>', b)
        out.append({
            "event_id": int(ev.group(1)),
            "date": dt.group(1) if dt else None,
            "start": dt.group(2) if dt else None,
            "end": dt.group(3) if dt else None,
            "home_team_id": int(left.group(1)) if left else None,
            "away_team_id": int(right.group(1)) if right else None,
            "home_score": int(nums[0][0]) if nums else None,
            "away_score": int(nums[0][1]) if nums else None,
            # The venue lives in the listing, not on the game page: scores.php
            # only carries it once a game has been played, so scheduled fixtures
            # would otherwise have no court to show anywhere in the dashboard.
            "venue": match_venue(b),
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
            sp = re.search(r"<span>([^<]+)</span>", b)
            left = re.search(r'r-side left" href="[^"]*team_id=(\d+)"', b)
            right = re.search(r'r-side right" href="[^"]*team_id=(\d+)"', b)
            nums = re.findall(r'<span class="[^"]*">(\d+)</span>\s*<span>-</span>\s*<span class="[^"]*">(\d+)</span>', b)
            schedule.append({
                "event_id": int(ev.group(1)),
                "group": sp.group(1).strip() if sp else None,
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
        out["home_team_name"] = side_info["left"]["name"]
    if "right" in side_info:
        out["away_team_id"] = side_info["right"]["team_id"]
        out["away_team_name"] = side_info["right"]["name"]

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
    # a 0-0 result means the game was never played (walkover / void): the site's
    # standings do not count it at all, so drop the scores and exclude it
    if out["status"] == "completed" and out["home_score"] == 0 and out["away_score"] == 0:
        out["status"] = "not_played"
        out["home_score"] = out["away_score"] = None
    # a default-score game (e.g. 20-0) where nobody logged any minutes is a
    # forfeit: the site records a win for the higher-scoring team and 棄 for the
    # loser (Blaze Phoenix vs Dreams Team, event 19954)
    elif out["box"] and all((r.get("minutes") or "0:00") == "0:00" for r in out["box"]):
        out["status"] = "forfeit"
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

    def upsert_group(self, season_id, group_id, name):
        self.conn.execute("INSERT INTO groups(season_id, group_id, name) VALUES(?,?,?) "
                          "ON CONFLICT(season_id, group_id) DO UPDATE SET name=excluded.name",
                          (season_id, group_id, name))

    def upsert_team(self, team_id, name):
        self.conn.execute("INSERT INTO teams(team_id, name) VALUES(?,?) "
                          "ON CONFLICT(team_id) DO UPDATE SET name=excluded.name", (team_id, name))

    def upsert_player(self, player_id, name):
        self.conn.execute("INSERT INTO players(player_id, name) VALUES(?,?) "
                          "ON CONFLICT(player_id) DO UPDATE SET name=CASE WHEN excluded.name != '' "
                          "THEN excluded.name ELSE players.name END", (player_id, name))

    def upsert_season_team(self, rec):
        cols = ["season_id", "team_id", "group_id", "manager", "captain_player_id",
                "home_color", "away_color", "season_pts_for", "season_pts_against"]
        vals = [rec.get(c) for c in cols]
        # cols[2:] — include group_id: the league moves teams between divisions
        # mid-season (season 33 moved UNION 1601 from U11 C to U13), and leaving
        # it out of the SET kept the old division forever.
        sets = ",".join(f"{c}=excluded.{c}" for c in cols[2:])
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

    def prune_standings(self, season_id, group_id, keep_team_ids):
        """Drop rows for teams the official table no longer lists in this group.

        Upserts alone cannot mirror a table: when the league moves a team to
        another division (season 33's U13 table swapped 1609 Wishful U11 for
        1601 UNION) the old row survived at its old rank and the group showed
        more teams than the official page. `keep` is the freshly parsed table,
        so an empty parse (markup change) never wipes a group.
        """
        keep = sorted(set(keep_team_ids))
        if not keep:
            return 0
        marks = ",".join("?" * len(keep))
        cur = self.conn.execute(
            f"DELETE FROM standings WHERE season_id=? AND group_id=? AND team_id NOT IN ({marks})",
            (season_id, group_id, *keep))
        return cur.rowcount

    def prune_season_teams(self, season_id, group_id, keep_team_ids):
        """Drop registrations for teams the group page no longer lists.

        A team belongs to one group per season (PRIMARY KEY season_id, team_id),
        so a mid-season move is normally fixed by the next upsert; this removes
        a team that was dropped from the group altogether. Guarded on an empty
        parse for the same reason as prune_standings().
        """
        keep = sorted(set(keep_team_ids))
        if not keep:
            return 0
        marks = ",".join("?" * len(keep))
        cur = self.conn.execute(
            f"DELETE FROM season_teams WHERE season_id=? AND group_id=? AND team_id NOT IN ({marks})",
            (season_id, group_id, *keep))
        return cur.rowcount

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
            "end_time=excluded.end_time, venue=COALESCE(excluded.venue, games.venue), "
            "home_team_id=excluded.home_team_id, "
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
            "ON CONFLICT(event_id, team_id, player_id) DO UPDATE SET "
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

    def clear_game_details(self, event_id):
        for table in ("player_game_stats", "game_quarters", "game_team_stats"):
            self.conn.execute(f"DELETE FROM {table} WHERE event_id=?", (event_id,))

    def replace_game(self, game):
        self.upsert_game(game)
        self.clear_game_details(game["event_id"])
        for q in game.get("quarters", []):
            self.upsert_quarters({**q, "event_id": game["event_id"]})
        for ts in game.get("team_stats", []):
            self.upsert_team_stats({**ts, "event_id": game["event_id"]})
        for row in game.get("box", []):
            self.upsert_player(row["player_id"], row["name"])
            self.upsert_box(row)

    def prune_pending_games(self, season, group, keep):
        # Listing disappearance withdraws pending fixtures, not recorded history.
        pending = self.conn.execute("SELECT event_id FROM games WHERE season_id=? "
                                    "AND group_id=? AND status='scheduled'", (season, group)).fetchall()
        for (eid,) in pending:
            if eid not in keep:
                self.clear_game_details(eid)
                self.conn.execute("DELETE FROM games WHERE event_id=?", (eid,))


# --------------------------------------------------------------------------
# pipeline
# --------------------------------------------------------------------------

class ScrapeError(ValueError):
    """A source response is incomplete; never promote this refresh."""


def require_page(html, label, marker=None):
    if ('id="main-content"' not in html or '</html>' not in html.lower()
            or (marker is not None and not re.search(marker, html, re.S))):
        raise ScrapeError(f"Incomplete or unrecognized source page: {label}")


def require_schedule_rows(html, group_name, rows):
    """A changed row class must not turn a populated schedule into an empty set."""
    expected = set()
    for block in re.findall(r'<li\b[^>]*>(.*?)</li>', html, re.S):
        match = re.search(r'event_id=(\d+)', block)
        label = re.search(r"<span>([^<]+)</span>", block)
        if match and label and label.group(1).strip() == group_name:
            expected.add(int(match.group(1)))
    parsed = {row["event_id"] for row in rows if row.get("group", group_name) == group_name}
    if expected != parsed:
        raise ScrapeError(f"Incomplete schedule rows for {group_name}")


def settled_score_age(previous, event, incremental, today):
    """Cache unchanged recent results briefly, with a longer historical horizon."""
    if not incremental or previous is None:
        return None
    status = previous[0]
    scores = (None, None) if status == "not_played" and event["home_score"] == event["away_score"] == 0 else (event["home_score"], event["away_score"])
    signature = (status, *scores,
                 event["date"], event["start"], event["end"])
    unchanged = (status in ("completed", "forfeit", "not_played") and tuple(previous[:6]) == signature
                 and (not event.get("venue") or previous[6] == event["venue"]))
    recent = datetime.date.fromisoformat(event["date"]) >= today - datetime.timedelta(days=14)
    return (15 * 60 if recent else 7 * 86400) if unchanged else None


def scrape_group(cache, store, season_id, group_id, incremental=False):
    div = cache.get(f"{BASE}division.php?season_id={season_id}&group_id={group_id}")
    require_page(div, f"division s{season_id}/g{group_id}", r'<div class="kopa-main-col">')
    title = re.search(r'<h3 class="widget-title style12"><span class="myfont"[^>]*>([^<]+)</span>', div)
    if not title or not title.group(1).strip():
        raise ScrapeError(f"Division s{season_id}/g{group_id} has no title")
    group_name = title.group(1).strip()
    print(f"group: {group_name} (s{season_id}/g{group_id})")
    store.upsert_season(season_id, f"第{season_id}屆驍籃青少年籃球聯賽")
    store.upsert_group(season_id, group_id, group_name)
    teams = parse_division_teams(div)
    main = extract_div_block(div, div.index('<div class="kopa-main-col">'))
    if not teams and 'team_id=' in main:
        raise ScrapeError(f"Team list failed to parse: {group_name}")
    old_teams = {row[0] for row in store.conn.execute(
        "SELECT team_id FROM season_teams WHERE season_id=? AND group_id=?", (season_id, group_id))}
    old_boards = {tuple(row) for row in store.conn.execute(
        "SELECT category,rank,player_id,team_id,games_played,total,avg FROM stat_leaderboards WHERE season_id=? AND group_id=?", (season_id, group_id))}
    for tid, name in teams:
        store.upsert_team(tid, name)
    # Reconcile only after complete pages have passed their structure checks.
    store.conn.execute("DELETE FROM season_teams WHERE season_id=? AND group_id=?", (season_id, group_id))
    for tid, _ in teams:
        store.upsert_season_team({"season_id": season_id, "team_id": tid, "group_id": group_id})

    standings_html = cache.get(f"{BASE}division.php?season_id={season_id}")
    require_page(standings_html, "season standings", r'<h3[^>]*>.*?分組表')
    standings = parse_standings(standings_html, group_name)
    if teams and not standings:
        raise ScrapeError(f"Missing standings for {group_name}")
    store.conn.execute("DELETE FROM standings WHERE season_id=? AND group_id=?", (season_id, group_id))
    for row in standings:
        store.upsert_standings({**row, "season_id": season_id, "group_id": group_id})

    board_html = cache.get(f"{BASE}statistics.php?season_id={season_id}&group_id={group_id}")
    require_page(board_html, "leaderboards", r'<div class="widget kopa-entry-list statistics-table">')
    for category in CATEGORY_CN:
        if not re.search(r'<h3[^>]*><span[^>]*>' + re.escape(category) + r'</span>', board_html):
            raise ScrapeError(f"Missing leaderboard category {category}")
    boards = parse_leaderboards(board_html)
    new_boards = {(r["category"], r["rank"], r["player_id"], r["team_id"], r["games"], r["total"], r["avg"]) for r in boards}
    # Rank changes still update the public leaderboard, but unchanged metrics
    # are not evidence that a team's roster or historical score pages changed.
    old_metrics = {(r[0], *r[2:]) for r in old_boards}
    new_metrics = {(r[0], *r[2:]) for r in new_boards}
    changed_board_teams = {r[2] for r in old_metrics ^ new_metrics}
    board_main = extract_div_block(board_html, board_html.index('<div class="widget kopa-entry-list statistics-table">'))
    expected_players = set(re.findall(r'player_id=(\d+)', board_main))
    if expected_players != {str(row["player_id"]) for row in boards}:
        raise ScrapeError(f"Incomplete leaderboard rows for {group_name}")
    store.conn.execute("DELETE FROM stat_leaderboards WHERE season_id=? AND group_id=?", (season_id, group_id))
    for row in boards:
        store.upsert_player(row["player_id"], row["player_name"])
        store.upsert_team(row["team_id"], row["team_name"])
        store.upsert_leaderboard({**row, "season_id": season_id, "group_id": group_id})

    schedule_html = cache.get(f"{BASE}schedule.php?season_id={season_id}")
    require_page(schedule_html, "season schedule", r'<div class="widget kopa-match-list-widget schedule-table">')
    season_events = parse_schedule_season(schedule_html, group_name)
    require_schedule_rows(schedule_html, group_name, season_events)
    events = {r["event_id"]: r for r in season_events}
    dirty_teams = {tid for tid, _ in teams if tid not in old_teams} | changed_board_teams
    for eid, home, away in store.conn.execute(
            "SELECT event_id,home_team_id,away_team_id FROM games WHERE season_id=? AND group_id=? AND status='scheduled'",
            (season_id, group_id)):
        if eid not in events:
            # Freshly check both secondary schedules before withdrawing a fixture.
            dirty_teams.update((home, away))
    for event in season_events:
        old = store.conn.execute("SELECT home_score,away_score,game_date,start_time,end_time,home_team_id,away_team_id,venue FROM games WHERE event_id=?", (event["event_id"],)).fetchone()
        advertised_scores = (None, None) if event["home_score"] == event["away_score"] == 0 else (event["home_score"], event["away_score"])
        signature = (*advertised_scores, event["date"], event["start"], event["end"], event["home_team_id"], event["away_team_id"])
        if old is None or tuple(old[:7]) != signature or (event.get("venue") and old[7] != event["venue"]):
            dirty_teams.update((event["home_team_id"], event["away_team_id"]))
    for row in boards:
        if not store.conn.execute("SELECT 1 FROM rosters WHERE season_id=? AND team_id=? AND player_id=?", (season_id, row["team_id"], row["player_id"])).fetchone():
            dirty_teams.add(row["team_id"])
    for tid, name in teams:
        html = cache.get(f"{BASE}teams_detail_info.php?season_id={season_id}&team_id={tid}",
                         max_age=TEAM_PAGE_MAX_AGE if incremental and tid not in dirty_teams else None)
        require_page(html, f"team {tid}", r'<div class="player-profile">')
        if widget_block_before(html, "隊員名單") is None or widget_block_before(html, "賽程") is None:
            raise ScrapeError(f"Missing roster or schedule for team {tid}")
        profile, roster, schedule = parse_team_page(html, season_id, tid)
        require_schedule_rows(widget_block_before(html, "賽程"), group_name, schedule)
        roster_block = widget_block_before(html, "隊員名單")
        if len(set(re.findall(r'player_id=(\d+)', roster_block))) != len(roster):
            raise ScrapeError(f"Incomplete roster for team {tid}")
        if profile.get("captain_player_id"):
            store.upsert_player(profile["captain_player_id"], "")
        store.upsert_season_team({**profile, "group_id": group_id})
        store.conn.execute("DELETE FROM rosters WHERE season_id=? AND team_id=?", (season_id, tid))
        for row in roster:
            store.upsert_player(row["player_id"], row["name"])
            store.upsert_roster({**row, "season_id": season_id, "team_id": tid})
        for row in schedule:
            if row.get("group") == group_name:
                # Prefer the season listing, which also includes the court.
                events.setdefault(row["event_id"], row)

    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    for eid, event in sorted(events.items()):
        if not event.get("date") or not event.get("home_team_id") or not event.get("away_team_id"):
            raise ScrapeError(f"Incomplete fixture {eid}")
        if event["home_score"] is None:
            # Future score pages may be empty templates. The valid listing is
            # sufficient, including when a result is withdrawn or postponed.
            game = {**event, "season_id": season_id, "group_id": group_id, "status": "scheduled"}
        else:
            old = store.conn.execute("SELECT status, home_score, away_score, game_date, start_time, end_time, venue FROM games WHERE event_id=?", (eid,)).fetchone()
            # Changed fixture/leaderboard data bypasses the disk cache. Recent
            # results have a 15-minute ceiling; unchanged old results get a week.
            age = settled_score_age(old, event, incremental, today)
            if {event["home_team_id"], event["away_team_id"]} & changed_board_teams:
                age = None
            html = cache.get(f"{BASE}scores.php?season_id={season_id}&event_id={eid}", max_age=age)
            require_page(html, f"game {eid}")
            game = parse_scores_page(html, season_id, eid)
            if not game["home_team_id"] or not game["away_team_id"] or not game["date"]:
                raise ScrapeError(f"Missing score details for result {eid}")
            if game["status"] in ("completed", "forfeit"):
                for label, team_key in (("主隊總計數據", "home_team_id"), ("客隊總計數據", "away_team_id")):
                    block = widget_block_after(html, label, "player_stats")
                    expected = set(re.findall(r'player_id=(\d+)', block or ""))
                    parsed = {str(row["player_id"]) for row in game["box"] if row["team_id"] == game[team_key]}
                    if not block or not expected or expected != parsed:
                        raise ScrapeError(f"Incomplete box score for result {eid}")
                if len(game["quarters"]) != 2 or len(game["team_stats"]) != 2:
                    raise ScrapeError(f"Incomplete quarter/team statistics for result {eid}")
            if (game["home_team_id"], game["away_team_id"]) != (event["home_team_id"], event["away_team_id"]):
                raise ScrapeError(f"Conflicting teams for result {eid}")
            # The listings and score pages must describe the same result.
            expected = (event["home_score"], event["away_score"])
            actual = (game["home_score"], game["away_score"])
            if expected != actual and not (expected == (0, 0) and game["status"] == "not_played"):
                raise ScrapeError(f"Conflicting scores for result {eid}")
            game.update(group_id=group_id, date=event["date"], start=event["start"],
                        end=event["end"], venue=event.get("venue") or game["venue"])
        for side in ("home", "away"):
            tid = game[side + "_team_id"]
            if not store.conn.execute("SELECT 1 FROM teams WHERE team_id=?", (tid,)).fetchone():
                name = game.get(side + "_team_name")
                if not name:
                    raise ScrapeError(f"Missing source name for historical team {tid}")
                store.upsert_team(tid, name)
        store.replace_game(game)
    keep = set(events)
    store.prune_pending_games(season_id, group_id, keep)
    store.commit()
    print(f"  {len(teams)} teams, {len(events)} fixtures")


# Refresh all current season girls/boys divisions together to share source pages.
ACTIVE_GROUPS = [(32, g) for g in (26, 27, 28, 30, 31)] + [(33, g) for g in (25, 26, 27, 11, 16, 28, 29)] + [(33, g) for g in (14, 34, 35, 2, 15, 17, 18, 19, 37, 38, 3, 12, 20, 21, 32, 36, 4, 5, 6, 9, 22, 23, 31, 33, 7, 8, 13, 24, 30, 10)]


def refresh_database(db_path, selections, cache, incremental=False):
    """Validate a complete staged refresh; leave the original byte-identical on failure/no-op."""
    from refresh_diff import dataset_digest
    db_path = os.path.abspath(db_path)
    fd, staged = tempfile.mkstemp(prefix=".hillen-refresh-", suffix=".db", dir=os.path.dirname(db_path))
    os.close(fd)
    store = None
    before = None
    try:
        if os.path.exists(db_path):
            with closing(sqlite3.connect(db_path)) as source, closing(sqlite3.connect(staged)) as target:
                before = dataset_digest(source)
                source.backup(target)
        store = Store(staged)
        for season, group in selections:
            scrape_group(cache, store, season, group, incremental)
        for season in {s for s, _ in selections}:
            store.conn.execute("DELETE FROM rosters WHERE season_id=? AND NOT EXISTS "
                               "(SELECT 1 FROM season_teams st WHERE st.season_id=rosters.season_id "
                               "AND st.team_id=rosters.team_id)", (season,))
        store.commit()
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "validate.py"),
                        "--db", staged, "--quiet"], check=True)
        changed = before != dataset_digest(store.conn)
        if changed:
            now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")
            store.conn.execute("INSERT INTO refresh_meta VALUES('refreshed_at', ?) "
                               "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (now,))
            store.commit()
        store.conn.close()
        store = None
        if changed:
            os.replace(staged, db_path)
        print("Dataset changed" if changed else "No data changes; database preserved")
        return changed
    finally:
        if store:
            store.conn.close()
        if os.path.exists(staged):
            os.unlink(staged)


def main():
    ap = argparse.ArgumentParser(description="Hillen League scraper")
    ap.add_argument("--season", type=int, default=32)
    ap.add_argument("--group", type=int, default=26)
    ap.add_argument("--active", action="store_true", help="refresh all active season/group pairs in one validated batch")
    ap.add_argument("--db", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "hillen_league.db"))
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--refresh", action="store_true", help="revalidate all pages, ignoring disk freshness")
    mode.add_argument("--incremental", action="store_true", help="fresh listings; cache unchanged team pages 24 hours, recent scores 15 minutes, old results seven days")
    ap.add_argument("--result-file", help="write machine-readable changed/request counts")
    args = ap.parse_args()
    started = time.perf_counter()
    here = os.path.dirname(os.path.abspath(__file__))
    cache = Fetcher(os.path.join(here, "cache"), refresh=args.refresh or args.incremental)
    try:
        changed = refresh_database(args.db, ACTIVE_GROUPS if args.active else [(args.season, args.group)], cache, args.incremental)
    finally:
        cache.close()
    metrics = {"changed": changed, "seconds": time.perf_counter() - started, **cache.metrics()}
    if args.result_file:
        with open(args.result_file, "w", encoding="utf-8") as f:
            json.dump(metrics, f, indent=2)
    print(f"Network requests: {metrics['requests']}; unique pages: {metrics['unique_pages']}; "
          f"bytes: {cache.network_bytes}; seconds: {metrics['seconds']:.3f}")
    print("Network requests by page: " + ", ".join(
        f"{name}={count}" for name, count in metrics["requests_by_page"].items()
    ))


if __name__ == "__main__":
    main()
