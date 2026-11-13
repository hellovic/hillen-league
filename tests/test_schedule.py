import datetime
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("schedule_check", Path(__file__).resolve().parents[1] / "scripts/check_refresh_schedule.py")
schedule = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schedule)


class ScheduleTests(unittest.TestCase):
    def test_weekday_delay_uses_the_triggering_cron(self):
        now = datetime.datetime(2026, 11, 4, 5, 45, tzinfo=datetime.timezone.utc)
        self.assertEqual(datetime.timedelta(hours=5, minutes=40), schedule.schedule_delay("5 0 * * 1-5", now))

    def test_weekend_uses_latest_elapsed_slot(self):
        now = datetime.datetime(2026, 11, 7, 3, 20, tzinfo=datetime.timezone.utc)
        self.assertEqual(datetime.timedelta(minutes=15), schedule.schedule_delay("5 1,3,5,7,10,13,15 * * 0,6", now))

    def test_audit_distinguishes_late_starts_and_missed_windows(self):
        crons = ["5 0 * * 1-5", "35 2 * * 1-5", "5 1,3,5,7,10,13,15 * * 0,6"]
        now = datetime.datetime.fromisoformat("2026-11-07T04:40:00+00:00")
        base = {"event": "schedule", "head_branch": "main", "status": "completed", "conclusion": "success"}
        runs = [
            {**base, "run_started_at": "2026-11-07T01:20:00Z"},
            {**base, "run_started_at": "2026-11-07T03:50:00Z"},
            {**base, "run_started_at": "2026-11-07T03:10:00Z", "status": "queued", "conclusion": None},
            {**base, "run_started_at": "2026-11-07T03:15:00Z", "event": "workflow_dispatch"},
        ]
        rows, outside = schedule.audit_schedule(crons, runs, now)
        self.assertEqual(24, len(rows))
        self.assertEqual(1, outside)
        self.assertEqual(datetime.datetime.fromisoformat("2026-11-07T01:20:00Z"), rows[-2][1])
        self.assertIsNone(rows[-1][1])


if __name__ == "__main__":
    unittest.main()
