import { useEffect, useRef } from "react";
import { paintStoryJersey } from "../components/StoryJersey.jsx";
import { signed } from "../utils.js";

const WIDTH = 720;
const HEIGHT = 820;
const COLORS = { background: "#101112", card: "#1b1d20", line: "#34383d", white: "#f5f6f7", muted: "#b0b5bd", orange: "#ff8b50", cyan: "#72d4e8" };

function paintPoster(canvas, story, note) {
  const ctx = canvas.getContext("2d");
  const { background, card, line, white, muted, orange, cyan } = COLORS;
  function rect(x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }
  function text(value, x, y, size, color = white, weight = 700, maxWidth = 608) {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(String(value), x, y, maxWidth);
  }

  const lastSeason = story.scope.at(-1);
  const seasonLine = story.scope.length === 1 ? `SEASON ${lastSeason}` : `SEASONS ${story.scope[0]}–${lastSeason}`;
  const header = ctx.createLinearGradient(0, 0, WIDTH, 280);
  header.addColorStop(0, "#392820");
  header.addColorStop(1, background);

  rect(0, 0, WIDTH, HEIGHT, background);
  rect(0, 0, WIDTH, 292, header);
  rect(0, 0, WIDTH, 9, orange);
  rect(56, 52, 48, 48, orange);
  text("HL", 63, 85, 24, background, 900);
  text("HILLEN LEAGUE  /  PLAYER STORY", 120, 83, 18, orange, 800);
  paintStoryJersey(ctx, { name: story.name, number: story.jersey, x: 56, y: 106, width: 152 });
  text(seasonLine, 232, 161, 19, muted, 800);
  text(story.name, 232, 236, 62, white, 800, 432);
  text(story.team, 232, 275, 24, muted, 600, 432);
  rect(56, 306, 608, 2, line);

  const totals = Object.entries(story.totals);
  totals.forEach(([label, value], index) => {
    const x = 56 + (index % 2) * 312;
    const y = 335 + Math.floor(index / 2) * 118;
    rect(x, y, 296, 102, card);
    text(label.toUpperCase(), x + 20, y + 27, 16, muted, 800);
    text(value, x + 20, y + 78, 44, index % 2 ? orange : white, 800);
  });

  text("BEST IN COLLECTED GAMES", 56, 604, 18, cyan, 800);
  const bests = [["PTS", story.best.pts?.pts], ["REB", story.best.tot_reb?.tot_reb], ["EFF", story.best.eff ? signed(story.best.eff.eff) : null]];
  bests.forEach(([label, value], index) => {
    const x = 56 + index * 207;
    rect(x, 625, 194, 82, card);
    text(label, x + 16, 652, 16, muted, 800);
    text(value ?? "—", x + 16, 692, 32, white, 800);
  });
  rect(56, 740, 608, 2, line);
  text(note, 56, 775, 18, muted, 500);
}

export default function StoryPoster({ story, posterRef, archiveNote }) {
  const canvasRef = useRef(null);
  useEffect(() => { paintPoster(canvasRef.current, story, archiveNote); }, [story, archiveNote]);

  function downloadPoster() {
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hillen-player-story-${story.id}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  }

  return (
    <dialog className="story-poster-dialog" ref={posterRef} aria-labelledby="story-poster-title">
      <div className="story-poster-head">
        <h2 id="story-poster-title">Share Story Poster</h2>
        <form method="dialog"><button type="submit" className="story-button" aria-label="Close poster">×</button></form>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} role="img"
        aria-label={`Career summary poster for ${story.name}${story.jersey == null ? "" : `, jersey number ${story.jersey}`}`} />
      <button type="button" className="story-button story-primary" onClick={downloadPoster}>Download PNG</button>
    </dialog>
  );
}
