"""Report the refresh delay and audit recent GitHub Actions start times."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request


UTC = datetime.timezone.utc
HKT = datetime.timezone(datetime.timedelta(hours=8))
START_WINDOW = datetime.timedelta(minutes=30)
WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/refresh.yml"


def slots_on(cron, date):
    minute, hours, day_of_month, month, weekdays = cron.split()
    days = {"1-5": {1, 2, 3, 4, 5}, "0,6": {0, 6}}
    if day_of_month != "*" or month != "*" or weekdays not in days:
        raise ValueError(f"Unsupported refresh cron: {cron}")
    if (date.weekday() + 1) % 7 in days[weekdays]:
        for hour in hours.split(","):
            yield datetime.datetime.combine(date, datetime.time(int(hour), int(minute)), UTC)


def schedule_delay(cron, now):
    for days in range(8):
        date = (now - datetime.timedelta(days=days)).date()
        past = [slot for slot in slots_on(cron, date) if slot <= now]
        if past:
            return now - max(past)
    raise ValueError("No matching scheduled slot")


def scheduled_starts(repository, since, token):
    query = urllib.parse.urlencode({"event": "schedule", "branch": "main",
                                   "created": f">={since.isoformat()}", "per_page": 100})
    url = f"https://api.github.com/repos/{repository}/actions/workflows/refresh.yml/runs?{query}"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as response:
        payload = json.load(response)
    if payload["total_count"] > len(payload["workflow_runs"]):
        raise ValueError("GitHub returned an incomplete run history")
    return payload["workflow_runs"]


def audit_schedule(crons, runs, now):
    since = now - datetime.timedelta(days=7)
    starts = sorted(datetime.datetime.fromisoformat(run["run_started_at"])
                    for run in runs if run["event"] == "schedule" and run["head_branch"] == "main"
                    and run.get("run_started_at") and run["status"] not in {"queued", "pending", "requested", "waiting"}
                    and run["conclusion"] not in {"cancelled", "skipped"})
    slots = sorted(slot for day in range(8) for cron in crons
                   for slot in slots_on(cron, since.date() + datetime.timedelta(days=day))
                   if since <= slot <= now - START_WINDOW)
    covered = set()
    rows = []
    for slot in slots:
        matches = [idx for idx, start in enumerate(starts) if slot <= start < slot + START_WINDOW]
        covered.update(matches)
        started = starts[matches[0]] if matches else None
        rows.append((slot, started))
    outside = sum(since <= start <= now - START_WINDOW and idx not in covered
                  for idx, start in enumerate(starts))
    return rows, outside


def write_summary(message):
    print(message)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as report:
            report.write(f"{message}\n\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true", help="compare the past seven days of slots and runs")
    parser.add_argument("--runs-file", type=Path, help="replay a GitHub runs API response")
    parser.add_argument("--as-of", type=datetime.datetime.fromisoformat, help="audit cutoff with UTC offset")
    args = parser.parse_args()
    now = args.as_of or datetime.datetime.now(UTC)
    if now.tzinfo is None:
        parser.error("--as-of needs a UTC offset")
    now = now.astimezone(UTC)

    if not args.audit:
        minutes = int(schedule_delay(os.environ["REFRESH_CRON"], now).total_seconds() // 60)
        message = f"Nearest elapsed slot for this cron was {minutes} minutes ago."
        print(("::warning::" if minutes >= 30 else "") + message)
        return

    crons = re.findall(r"^\s*- cron: '([^']+)'", WORKFLOW.read_text(), re.M)
    if not crons:
        parser.error("No scheduled slots found in refresh.yml")
    runs = (json.loads(args.runs_file.read_text())["workflow_runs"] if args.runs_file else
            scheduled_starts(os.environ.get("GITHUB_REPOSITORY", "hellovic/hillen-league"),
                             now - datetime.timedelta(days=7), os.environ.get("GH_TOKEN")))
    slots, outside = audit_schedule(crons, runs, now)
    count = sum(started is not None for _, started in slots)
    lines = [
        "### Automatic refresh starts in the past seven days",
        f"{count}/{len(slots)} slots had a scheduled start within 30 minutes. "
        f"{outside} starts fell outside those windows.",
        "A slot with no start in its window may still have run later. GitHub groups several weekend "
        "slots under one cron expression, so late runs cannot be matched to an exact slot from this history.",
        "",
        "| Scheduled slot (HKT) | First automatic start inside the window (HKT) |",
        "| --- | --- |",
    ]
    for slot, started in slots:
        fmt = "%a %d %b %H:%M"
        actual = started.astimezone(HKT).strftime(fmt) if started else "No start in window"
        lines.append(f"| {slot.astimezone(HKT).strftime(fmt)} | {actual} |")
    write_summary("\n".join(lines))


if __name__ == "__main__":
    main()
