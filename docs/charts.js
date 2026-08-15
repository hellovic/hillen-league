/* charts.js — tiny dependency-free SVG chart helpers for the dashboard.
 * All charts are responsive via viewBox and use the site's CSS palette. */
"use strict";

const CHART = {
  W: 560, H: 220,
  pad: { t: 22, r: 12, b: 28, l: 34 },
  colors: ["#fc6306", "#35c6e6", "#2ecc71", "#e74c3c", "#ffd166", "#9b59b6"],
};

function escAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function chartSvg(inner, w = CHART.W, h = CHART.H, cls = "chart") {
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
}

function chartLegend(series, x0 = 20) {
  return series.map((s, i) =>
    `<g transform="translate(${x0 + i * 92}, 14)"><rect width="10" height="10" rx="2" fill="${s.color}"/>` +
    `<text x="14" y="10" class="chart-legend">${escAttr(s.name)}</text></g>`).join("");
}

function chartGrid(pad, w, h, maxY) {
  let out = "";
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + (h - pad.t - pad.b) * i / 4;
    const val = maxY - maxY * i / 4;
    out += `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${w - pad.r}" y2="${gy.toFixed(1)}" class="chart-grid"/>` +
           `<text x="${pad.l - 5}" y="${(gy + 3).toFixed(1)}" text-anchor="end" class="chart-tick">${Math.round(val)}</text>`;
  }
  return out;
}

/* Grouped vertical bars.
 * rows: [{label, values:[v1, v2, ...]}], series: [{name, color}] (aligned by index).
 * opts.showValues: render the value above each bar. */
function groupedBars(rows, series, opts = {}) {
  const w = CHART.W, h = CHART.H, pad = { ...CHART.pad, ...(opts.pad || {}) };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(1, ...rows.flatMap(r => r.values));
  const groupW = iw / Math.max(1, rows.length);
  const barW = Math.min(26, Math.max(4, (groupW * 0.72) / Math.max(1, series.length)));
  const y = (v) => pad.t + ih - (v / max) * ih;
  let out = chartGrid(pad, w, h, max);
  rows.forEach((r, ri) => {
    const gx = pad.l + ri * groupW + (groupW - barW * series.length) / 2;
    r.values.forEach((v, si) => {
      const bh = Math.max((v / max) * ih, v > 0 ? 1 : 0);
      const bx = gx + si * barW;
      out += `<rect x="${bx.toFixed(1)}" y="${(y(v)).toFixed(1)}" width="${barW.toFixed(1)}" ` +
             `height="${bh.toFixed(1)}" fill="${series[si].color}" rx="2">` +
             `<title>${escAttr(r.label)} · ${escAttr(series[si].name)}: ${v}</title></rect>`;
      if (opts.showValues && v > 0) {
        out += `<text x="${(bx + barW / 2).toFixed(1)}" y="${(y(v) - 3).toFixed(1)}" text-anchor="middle" class="chart-val">${v}</text>`;
      }
    });
    const cx = gx + groupW / 2;
    out += `<text x="${cx.toFixed(1)}" y="${h - 6}" text-anchor="middle" class="chart-label">${escAttr(r.label)}</text>`;
  });
  return chartSvg(out + chartLegend(series));
}

/* Multi-series line chart over game index.
 * series: [{name, color, points: [{x, y, label}]}] (x = 0..n-1). */
function lineChart(series, opts = {}) {
  const w = CHART.W, h = CHART.H, pad = { ...CHART.pad, ...(opts.pad || {}) };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const all = series.flatMap(s => s.points);
  const maxY = Math.max(1, ...all.map(p => p.y));
  const n = Math.max(2, ...series.map(s => s.points.length));
  const x = (i) => pad.l + (n === 1 ? iw / 2 : i * iw / (n - 1));
  const y = (v) => pad.t + ih - (v / maxY) * ih;
  let out = chartGrid(pad, w, h, maxY);
  series.forEach((s, si) => {
    if (!s.points.length) return;
    const color = s.color || CHART.colors[si % CHART.colors.length];
    const path = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
    out += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.points.forEach(p => {
      out += `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3.4" fill="${color}">` +
             `<title>${escAttr(p.label || p.x)}: ${p.y}</title></circle>`;
    });
    out += `<text x="${x(s.points[s.points.length - 1].x).toFixed(1)}" y="${(y(s.points[s.points.length - 1].y) - 8).toFixed(1)}" ` +
           `text-anchor="middle" class="chart-legend">${escAttr(s.points[s.points.length - 1].label || "")}</text>`;
  });
  return chartSvg(out + chartLegend(series));
}

/* Radar chart. axes: [{label, max}], series: [{name, color, values}] (0..max). */
function radarChart(axes, series, opts = {}) {
  const w = CHART.W, h = CHART.H;
  const cx = w / 2, cy = h / 2 + 4, R = Math.min(w, h) / 2 - 46;
  const n = axes.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  let out = "";
  for (let ring = 1; ring <= 4; ring++) {
    const r = R * ring / 4;
    out += `<polygon points="${axes.map((_, i) => pt(i, r).map(v => v.toFixed(1)).join(",")).join(" ")}" fill="none" class="chart-grid"/>`;
  }
  axes.forEach((ax, i) => {
    const [x1, y1] = pt(i, R), [x2, y2] = pt(i, R + 18);
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="chart-grid"/>`;
    out += `<text x="${x2.toFixed(1)}" y="${(y2 + 4).toFixed(1)}" text-anchor="middle" class="chart-label">${escAttr(ax.label)}</text>`;
  });
  series.forEach((s, si) => {
    const color = s.color || CHART.colors[si % CHART.colors.length];
    const pts = axes.map((ax, i) => {
      const v = Math.max(0, Math.min(1, (s.values[i] || 0) / (ax.max || 1)));
      return pt(i, R * v).map(x => x.toFixed(1)).join(",");
    }).join(" ");
    out += `<polygon points="${pts}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2"/>`;
  });
  return chartSvg(out + chartLegend(series, 20), w, h, "chart radar");
}
