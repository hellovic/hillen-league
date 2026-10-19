export const APP_TITLE = "Hillen League Dashboard";

export function fmtDate(d) {
  return d ? d.slice(5).replace("-", "/") : "";
}

export function setTitle(...parts) {
  document.title = parts.filter((p) => p != null && String(p) !== "").concat(APP_TITLE).join(" - ");
}

export function resultOf(g, teamId) {
  if (g.status !== "completed") return { text: "—", cls: "draw" };
  const mine = g.home_team_id === teamId ? g.home_score : g.away_score;
  const opp = g.home_team_id === teamId ? g.away_score : g.home_score;
  if (mine > opp) return { text: `W ${mine}-${opp}`, cls: "winner" };
  if (mine < opp) return { text: `L ${mine}-${opp}`, cls: "loser" };
  return { text: `T ${mine}-${opp}`, cls: "draw" };
}

export function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    let r;
    if (typeof va === "number" && typeof vb === "number") r = va - vb;
    else r = String(va ?? "").localeCompare(String(vb ?? ""), "zh");
    return dir === "asc" ? r : -r;
  });
}

/* Shooting-efficiency helpers (null when there are no attempts). */
export function efgPct(made, att, threes) {
  return att ? ((made + 0.5 * (threes || 0)) / att) * 100 : null;
}
export function tsPct(pts, fga, fta) {
  const tsa = fga + 0.44 * (fta || 0);
  return tsa ? (pts / (2 * tsa)) * 100 : null;
}
export function pctStr(v) {
  return v === null || v === undefined || isNaN(v) ? "—" : v.toFixed(1) + "%";
}

/* ---------------- routing fragments ---------------- */

export function contextQuery(ctx) {
  return `?season=${ctx.season}&group=${ctx.group}`;
}
export function contextHash(view, ctx) {
  return `#/${view}${contextQuery(ctx)}`;
}
export function seasonHash(season) {
  return `#/season/${season}`;
}
export function go(hash) {
  if (location.hash !== hash) location.hash = hash;
}

/* ---------------- share links ----------------
 * Copy the address the visitor is actually on. The export also publishes real
 * per-entity paths (games/<id>/, teams/<id>/…) with their own Open Graph tags,
 * but inside the SPA the current hash URL is what the user sees in the bar. */
/* Copy the URL of the generated share stub (`games/20863/`, `players/17864/`…),
 * not the current hash URL: only a real URL can carry og:/twitter: tags into a
 * chat-app link preview. The stub forwards to the equivalent hash route. */
function shareBase() {
  return location.origin + location.pathname.replace(/[^/]*$/, "");
}

function legacyCopy(text, ok) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    ok();
  } catch (e) {
    prompt("Copy this link:", text);
  }
  document.body.removeChild(ta);
}

export function copyShareLink(btn, kind, id) {
  const url = `${shareBase()}${kind}/${id}/`;
  const done = () => {
    const was = btn.textContent;
    btn.textContent = "✓ Copied";
    setTimeout(() => {
      btn.textContent = was;
    }, 1500);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(done, () => legacyCopy(url, done));
  } else {
    legacyCopy(url, done);
  }
}

/* ---------------- CSV export ---------------- */

export function csvDownload(filename, headers, rows) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = "\ufeff" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- comparison rows ---------------- */

/* one comparison row; better value gets .hi (numeric comparison!) */
export function cmpRow(label, va, vb, lowerBetter = false) {
  const num = (v) => (v === null || v === undefined || v === "" ? "—" : v);
  const numv = (v) => (typeof v === "number" ? v : parseFloat(v));
  const better = (x, y) => {
    const nx = numv(x), ny = numv(y);
    if (isNaN(nx) || isNaN(ny) || nx === ny) return "";
    return (nx > ny) !== lowerBetter ? "hi" : "lo";
  };
  return { label, a: num(va), b: num(vb), clsA: better(va, vb), clsB: better(vb, va) };
}
