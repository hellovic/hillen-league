import { useState } from "react";
import { useLocale } from "../locale.jsx";
import { todayHk } from "../utils.js";

function weekendDates() {
  const saturday = new Date(`${todayHk()}T00:00:00Z`);
  const weekday = saturday.getUTCDay();
  saturday.setUTCDate(saturday.getUTCDate() + (weekday === 0 ? -1 : 6 - weekday));
  const sunday = new Date(saturday);
  sunday.setUTCDate(sunday.getUTCDate() + 1);
  return [saturday, sunday];
}

export default function WeekendFixtures({ games }) {
  const { t: tr, group, language } = useLocale();
  const [selection, setSelection] = useState(null);
  const label = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-Hant-HK", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
  const days = weekendDates().map((date) => {
    const key = date.toISOString().slice(0, 10);
    return { key, label: label.format(date), fixtures: games.filter((game) => game.game_date === key) };
  });
  const firstDayWithGames = days.find((day) => day.fixtures.length);
  if (!firstDayWithGames) return null;
  const active = days.find((day) => day.key === selection) || firstDayWithGames;

  return (
    <section className="card weekend-fixtures" aria-labelledby="weekend-fixtures-heading">
      <h3 id="weekend-fixtures-heading">{tr("Weekend fixtures")}</h3>
      <div className="dashboard-options" role="group" aria-label={tr("Fixture date")}>
        {days.map((day) => (
          <button key={day.key} type="button" aria-pressed={day === active} onClick={() => setSelection(day.key)}>
            {day.label}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {active.fixtures.length ? active.fixtures.map((game) => (
          <a className="weekend-fixture" key={game.event_id} href={`#/games/${game.event_id}`}>
            <span className="weekend-fixture-meta">
              <strong>{game.start_time || tr("Time TBC")}</strong>
              <span className="gr-group">{language === "zh-Hant" ? group(game.group_name) : game.group_short}</span>
            </span>
            <span className="weekend-fixture-match">
              <span>{game.home_name} <span className="muted">{tr("vs")}</span> {game.away_name}</span>
              <span className="row-arrow" aria-hidden="true">↗</span>
            </span>
            <span className="gr-venue">{game.venue || tr("Venue TBC")}</span>
          </a>
        )) : <p className="muted">{tr("No fixtures on this day.")}</p>}
      </div>
    </section>
  );
}
