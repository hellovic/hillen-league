import { useT } from "../locale.jsx";
import { useState } from "react";
import { storySpotlights } from "../data.js";
import "../styles/story-promo.css";

export default function StoryPromo({ currentPlayerId }) {
  const tr = useT();
  const [player] = useState(() => {
    const candidates = storySpotlights.filter(({ ids }) => !ids.includes(currentPlayerId));
    return candidates[Math.floor(Math.random() * candidates.length)];
  });

  if (!player) return null;
  return (
    <a className="story-promo" href={`#/player-story/${player.ids[0]}`}>
      <span className="story-promo-badge">{tr("Story")}</span>
      <span className="story-promo-player">
        <strong title={player.name}>{player.name}</strong>
        <span className="story-promo-stats">· {tr("{points} PTS ({games} GP)", player)}</span>
      </span>
      <span className="story-promo-go">{tr("Go")} <span aria-hidden="true">›</span></span>
    </a>
  );
}
