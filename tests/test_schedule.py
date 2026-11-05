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


if __name__ == "__main__":
    unittest.main()
