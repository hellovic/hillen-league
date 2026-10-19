import { fmtDate } from "../utils.js";

/* <time class="compact-date"> — full date on desktop, MM/DD on phones (the
 * mobile stylesheet swaps .date-full for .date-short). */
export default function CompactDate({ date, time = "" }) {
  return (
    <time className="compact-date" dateTime={date}>
      <span className="date-full">{date}</span>
      <span className="date-short" aria-hidden="true">{fmtDate(date)}</span>
      {time ? <span className="date-time">{time}</span> : null}
    </time>
  );
}
