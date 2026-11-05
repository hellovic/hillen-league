import gzip
from email.message import Message
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scraper

PAGE = '<html><div id="main-content">Source page</div></html>'


def headers(**items):
    result = Message()
    for key, value in items.items():
        result[key.replace("_", "-")] = value
    return result


class FetcherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        with patch.object(scraper.Fetcher, "_ssl_context", return_value=None):
            self.fetcher = scraper.Fetcher(self.directory.name, refresh=True, delay=0)
        self.addCleanup(self.fetcher.close)

    def test_gzip_and_validator_revalidation(self):
        url = scraper.BASE + "division.php?season_id=33"
        self.fetcher._request = Mock(return_value=(200, headers(Content_Encoding="gzip", ETag='"source-v1"'), gzip.compress(PAGE.encode())))
        self.assertEqual(PAGE, self.fetcher.get(url))
        self.assertEqual("gzip", self.fetcher._request.call_args.args[1]["Accept-Encoding"])
        self.fetcher.responses.clear()
        self.fetcher._request.return_value = (304, headers(), b"")
        self.assertEqual(PAGE, self.fetcher.get(url))
        self.assertEqual('"source-v1"', self.fetcher._request.call_args.args[1]["If-None-Match"])
        self.assertEqual(1, self.fetcher.revalidations)

    def test_invalid_response_is_not_retried_or_cached(self):
        self.fetcher._request = Mock(return_value=(200, headers(), b"<html>Unavailable</html>"))
        with self.assertRaises(scraper.ScrapeError):
            self.fetcher.get(scraper.BASE + "division.php")
        self.assertEqual(1, self.fetcher._request.call_count)
        self.assertFalse(self.fetcher.responses)

    def test_rate_limit_respects_retry_after(self):
        self.fetcher._request = Mock(side_effect=[(429, headers(Retry_After="7"), b""), (200, headers(), PAGE.encode())])
        with patch.object(scraper.time, "sleep") as sleep:
            self.fetcher.get(scraper.BASE + "division.php")
        sleep.assert_any_call(7.0)
        self.assertEqual(1, self.fetcher.retries)

    def test_long_retry_after_aborts_without_hammering(self):
        self.fetcher._request = Mock(return_value=(503, headers(Retry_After="3600"), b""))
        with self.assertRaises(scraper.ScrapeError):
            self.fetcher.get(scraper.BASE + "division.php")
        self.assertEqual(1, self.fetcher._request.call_count)

    def test_two_urls_reuse_one_https_connection(self):
        response = Mock(status=200, headers=headers(), will_close=False)
        response.read.return_value = PAGE.encode()
        connection = Mock(sock=None)
        def request(*args, **kwargs):
            connection.sock = object()
        connection.request.side_effect = request
        connection.getresponse.return_value = response
        with patch.object(scraper.http.client, "HTTPSConnection", return_value=connection) as factory:
            self.fetcher.get(scraper.BASE + "division.php?season_id=32")
            self.fetcher.get(scraper.BASE + "division.php?season_id=33")
        factory.assert_called_once()
        self.assertEqual(2, self.fetcher.requests)
        self.assertEqual(1, self.fetcher.handshakes)

    def test_expired_cache_is_checked_but_fresh_cache_is_reused(self):
        url = scraper.BASE + "division.php"
        Path(self.fetcher._cache_path(url)).write_text(PAGE)
        self.fetcher._request = Mock(return_value=(200, headers(), PAGE.encode()))
        self.assertEqual(PAGE, self.fetcher.get(url, max_age=3600))
        self.fetcher._request.assert_not_called()
        self.fetcher.responses.clear()
        self.fetcher.get(url, max_age=0)
        self.fetcher._request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
