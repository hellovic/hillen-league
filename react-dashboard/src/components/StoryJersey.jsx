import { useT } from "../locale.jsx";

const WIDTH = 100;
const HEIGHT = 111;
const FONT = "system-ui, sans-serif";
const SHAPES = [
  { d: "M17 17 35 9Q50 28 65 9l18 8q-5 18 8 30l-9 11-2 41q-30 10-60 0l-2-41-9-11q13-12 8-30Z",
    fill: "#ff8b50", stroke: "#ffb78e" },
  { d: "m25 14 10-5q15 19 30 0l10 5q-2 21 10 34l-8 8-2 39q-25 7-50 0l-2-39-8-8q12-13 10-34Z",
    fill: "#24272b", stroke: "#101112" },
  { d: "M33 10q17 24 34 0", fill: "none", stroke: "#ffb78e" },
  { d: "M42 87h16", fill: "none", stroke: "#ff8b50" },
];

const jerseyNumber = (number) => number == null ? "—" : String(number).padStart(2, "0");

function lettering(name, number) {
  const surname = /^[\u3400-\u9fff]/.test(name) ? Array.from(name)[0] : name.split(/\s+/).at(-1).slice(0, 10);
  return [
    { text: surname, y: 47, fill: "#ffad70", fontSize: 10 },
    { text: jerseyNumber(number), y: 79, fill: "#fff", fontSize: 31 },
  ];
}

export function paintStoryJersey(ctx, { name, number, x, y, width }) {
  const scale = width / WIDTH;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineWidth = 2;
  for (const { d, fill, stroke } of SHAPES) {
    const path = new Path2D(d);
    if (fill !== "none") {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    ctx.strokeStyle = stroke;
    ctx.stroke(path);
  }
  ctx.textAlign = "center";
  for (const { text, y, fill, fontSize } of lettering(name, number)) {
    ctx.fillStyle = fill;
    ctx.font = `700 ${fontSize}px ${FONT}`;
    ctx.fillText(text, WIDTH / 2, y);
  }
  ctx.restore();
}

export default function StoryJersey({ name, number }) {
  const tr = useT();
  return (
    <div className="story-jersey">
      <div className="story-jersey-mark"><span>HLN</span><span>{number == null ? "" : `#${jerseyNumber(number)}`}</span></div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={number == null ? tr("Hillen League jersey") : tr("Primary jersey number {number}", { number })}>
        {SHAPES.map(({ d, fill, stroke }) => <path key={d} d={d} fill={fill} stroke={stroke} strokeWidth="2" />)}
        {lettering(name, number).map(({ text, y, fill, fontSize }) => (
          <text key={y} x={WIDTH / 2} y={y} textAnchor="middle" fill={fill} fontSize={fontSize} fontWeight="700" fontFamily={FONT}>{text}</text>
        ))}
      </svg>
    </div>
  );
}
