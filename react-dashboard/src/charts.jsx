/* charts.jsx — dependency-free SVG chart components.
 *
 * Direct port of charts.js: same geometry, same viewBox, same CSS hook classes
 * (chart-grid / chart-tick / chart-label / chart-val / chart-legend), so the
 * exported stylesheets style these exactly as they styled the vanilla output. */

const W = 560;
const H = 220;
const BASE_PAD = { t: 22, r: 12, b: 28, l: 34 };

function ChartSvg({ className = "chart", w = W, h = H, children }) {
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  );
}

function Grid({ pad, w, h, maxY }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => {
        const gy = pad.t + ((h - pad.t - pad.b) * i) / 4;
        const val = maxY - (maxY * i) / 4;
        return (
          <g key={i}>
            <line x1={pad.l} y1={gy.toFixed(1)} x2={w - pad.r} y2={gy.toFixed(1)} className="chart-grid" />
            <text x={pad.l - 5} y={(gy + 3).toFixed(1)} textAnchor="end" className="chart-tick">
              {Math.round(val)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function Legend({ series, x0 = 20 }) {
  return (
    <g>
      {series.map((s, i) => (
        <g key={i} transform={`translate(${x0 + i * 92}, 14)`}>
          <rect width="10" height="10" rx="2" fill={s.color} />
          <text x="14" y="10" className="chart-legend">
            {s.name}
          </text>
        </g>
      ))}
    </g>
  );
}

/* Grouped vertical bars.
 * rows: [{label, values:[v1, v2, ...]}], series: [{name, color}] (aligned by index).
 * opts.showValues: render the value above each bar. opts.h: SVG height. */
export function GroupedBars({ rows, series, showValues = false, h = H, pad }) {
  const w = W;
  const p = { ...BASE_PAD, ...(pad || {}) };
  const iw = w - p.l - p.r;
  const ih = h - p.t - p.b;
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const groupW = iw / Math.max(1, rows.length);
  const barW = Math.min(26, Math.max(4, (groupW * 0.72) / Math.max(1, series.length)));
  const y = (v) => p.t + ih - (v / max) * ih;
  return (
    <ChartSvg h={h}>
      <Grid pad={p} w={w} h={h} maxY={max} />
      {rows.map((r, ri) => {
        const gx = p.l + ri * groupW + (groupW - barW * series.length) / 2;
        const cx = p.l + ri * groupW + groupW / 2;
        return (
          <g key={ri}>
            {r.values.map((v, si) => {
              const bh = Math.max((v / max) * ih, v > 0 ? 1 : 0);
              const bx = gx + si * barW;
              return (
                <g key={si}>
                  <rect x={bx.toFixed(1)} y={y(v).toFixed(1)} width={barW.toFixed(1)} height={bh.toFixed(1)} fill={series[si].color} rx="2">
                    <title>{`${r.label} · ${series[si].name}: ${v}`}</title>
                  </rect>
                  {showValues && v > 0 ? (
                    <text x={(bx + barW / 2).toFixed(1)} y={(y(v) - 3).toFixed(1)} textAnchor="middle" className="chart-val">
                      {v}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text x={cx.toFixed(1)} y={h - 6} textAnchor="middle" className="chart-label">
              {r.label}
            </text>
          </g>
        );
      })}
      <Legend series={series} />
    </ChartSvg>
  );
}

/* Multi-series line chart over game index.
 * series: [{name, color, points: [{x, y, label}]}] (x = 0..n-1). */
export function LineChart({ series, h = H, pad }) {
  const w = W;
  const p = { ...BASE_PAD, ...(pad || {}) };
  const iw = w - p.l - p.r;
  const ih = h - p.t - p.b;
  const all = series.flatMap((s) => s.points);
  const maxY = Math.max(1, ...all.map((pt) => pt.y));
  const n = Math.max(2, ...series.map((s) => s.points.length));
  const x = (i) => p.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => p.t + ih - (v / maxY) * ih;
  return (
    <ChartSvg>
      <Grid pad={p} w={w} h={h} maxY={maxY} />
      {series.map((s, si) => {
        if (!s.points.length) return null;
        const color = s.color || series[si % series.length].color;
        const d = s.points.map((pt, i) => `${i ? "L" : "M"}${x(pt.x).toFixed(1)},${y(pt.y).toFixed(1)}`).join(" ");
        const last = s.points[s.points.length - 1];
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((pt, i) => (
              <circle key={i} cx={x(pt.x).toFixed(1)} cy={y(pt.y).toFixed(1)} r="3.4" fill={color}>
                <title>{`${pt.label || pt.x}: ${pt.y}`}</title>
              </circle>
            ))}
            <text x={x(last.x).toFixed(1)} y={(y(last.y) - 8).toFixed(1)} textAnchor="middle" className="chart-legend">
              {last.label || ""}
            </text>
          </g>
        );
      })}
      <Legend series={series} />
    </ChartSvg>
  );
}

/* Radar chart. axes: [{label, max}], series: [{name, color, values}] (0..max). */
export function RadarChart({ axes, series, className = "chart radar" }) {
  const w = W;
  const h = H;
  const cx = w / 2;
  const cy = h / 2 + 4;
  const R = Math.min(w, h) / 2 - 46;
  const n = axes.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  return (
    <ChartSvg className={className}>
      {[1, 2, 3, 4].map((ring) => (
        <polygon
          key={ring}
          points={axes.map((_, i) => pt(i, (R * ring) / 4).map((v) => v.toFixed(1)).join(",")).join(" ")}
          fill="none"
          className="chart-grid"
        />
      ))}
      {axes.map((ax, i) => {
        const [x1, y1] = pt(i, R);
        const [x2, y2] = pt(i, R + 18);
        return (
          <g key={i}>
            <line x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} className="chart-grid" />
            <text x={x2.toFixed(1)} y={(y2 + 4).toFixed(1)} textAnchor="middle" className="chart-label">
              {ax.label}
            </text>
          </g>
        );
      })}
      {series.map((s, si) => {
        const color = s.color || series[si % series.length].color;
        const pts = axes
          .map((ax, i) => {
            const v = Math.max(0, Math.min(1, (s.values[i] || 0) / (ax.max || 1)));
            return pt(i, R * v).map((v2) => v2.toFixed(1)).join(",");
          })
          .join(" ");
        return <polygon key={si} points={pts} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2" />;
      })}
      <Legend series={series} x0={20} />
    </ChartSvg>
  );
}
