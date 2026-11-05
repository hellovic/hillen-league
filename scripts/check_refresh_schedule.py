"""Report late GitHub scheduled starts; this cannot make cron punctual."""
import datetime
import os


def schedule_delay(cron, now):
    minute, hours, _, _, weekdays = cron.split()
    # These deliberately cover the workflow's fixed match-day schedules only.
    allowed_days = {1, 2, 3, 4, 5} if weekdays == "1-5" else {0, 6}
    for days in range(8):
        date = (now - datetime.timedelta(days=days)).date()
        if (date.weekday() + 1) % 7 not in allowed_days:
            continue
        candidates = [datetime.datetime.combine(date, datetime.time(int(h), int(minute)),
                                                tzinfo=datetime.timezone.utc)
                      for h in hours.split(",")]
        past = [t for t in candidates if t <= now]
        if past:
            return now - max(past)
    raise ValueError("No matching scheduled slot")


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    minutes = int(schedule_delay(os.environ["REFRESH_CRON"], now).total_seconds() // 60)
    message = f"Refresh started approximately {minutes} minutes after its scheduled slot."
    print(("::warning::" if minutes >= 45 else "") + message)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"{message}\n\nGitHub schedules are best effort; successful checks with unchanged data skip publication.\n")


if __name__ == "__main__":
    main()
