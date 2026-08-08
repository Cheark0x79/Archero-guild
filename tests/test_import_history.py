import unittest
from datetime import UTC, date, datetime

from observer.storage.import_history import ImportHistoryError, _public_record


class ImportHistoryTests(unittest.TestCase):
    def test_sanitizes_history_without_raw_payload_or_key(self) -> None:
        record = _public_record({
            "id": 4,
            "capture_date": date(2026, 8, 7),
            "agent_version": "0.1.15",
            "status": "published",
            "result": {"members": 40, "bossRankings": 36},
            "created_at": datetime(2026, 8, 8, 1, 0, tzinfo=UTC),
            "published_at": datetime(2026, 8, 8, 1, 1, tzinfo=UTC),
            "payload": {"secret": "private"},
            "idempotency_key": "private-key",
        })

        self.assertEqual(record["captureDate"], "2026-08-07")
        self.assertEqual(record["members"], 40)
        self.assertNotIn("payload", record)
        self.assertNotIn("idempotencyKey", record)

    def test_rejects_unbounded_limits_before_database_access(self) -> None:
        from observer.storage.import_history import read_import_history

        with self.assertRaises(ImportHistoryError):
            read_import_history("unused", limit=51)


if __name__ == "__main__":
    unittest.main()
