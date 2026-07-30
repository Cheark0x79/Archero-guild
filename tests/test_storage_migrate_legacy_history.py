import unittest

from observer.storage.migrate_legacy_history import (
    LegacyExpectations,
    LegacyHistoryError,
    _reconcile_against_newer_snapshot,
    validate_legacy_payload,
)
from unittest.mock import patch


class LegacyHistoryMigrationTests(unittest.TestCase):
    def payload(self):
        return {
            "schemaVersion": 1,
            "kind": "archero-legacy-history",
            "sourceSha256": "test-checksum",
            "preservedDates": ["2026-07-14"],
            "guildRoster": [
                {"playerId": "100", "name": "Player"},
                {"playerId": None, "name": "Former"},
            ],
            "dailyRawSnapshots": [
                {"date": "2026-07-14", "rows": [{"playerId": "100", "name": "Player"}]},
            ],
            "dailyBossRawSnapshots": [],
        }

    def expectations(self):
        return LegacyExpectations(
            source_sha256="test-checksum",
            member_dates=("2026-07-14",),
            boss_dates=(),
            roster_rows=2,
            roster_with_id=1,
            member_rows=1,
            boss_rows=0,
        )

    def test_validates_checksum_dates_and_totals(self):
        summary = validate_legacy_payload(self.payload(), self.expectations())

        self.assertEqual(summary.member_rows, 1)
        self.assertEqual(summary.roster_with_id, 1)

    def test_rejects_an_unapproved_date(self):
        payload = self.payload()
        payload["dailyRawSnapshots"][0]["date"] = "2026-07-15"

        with self.assertRaisesRegex(LegacyHistoryError, "member history dates"):
            validate_legacy_payload(payload, self.expectations())

    def test_rejects_a_different_source_file(self):
        payload = self.payload()
        payload["sourceSha256"] = "other"

        with self.assertRaisesRegex(LegacyHistoryError, "checksum"):
            validate_legacy_payload(payload, self.expectations())

    def test_reconciles_against_a_complete_newer_snapshot(self):
        connection = _FakeConnection(
            fetches=[
                (42, "2026-07-29", "2026-07-29T12:00:00+02:00"),
                (["100", "200"], 0),
            ]
        )

        with patch("observer.storage.migrate_legacy_history._reconcile_active_roster") as reconcile:
            _reconcile_against_newer_snapshot(connection)

        reconcile.assert_called_once_with(
            connection.cursor_instance,
            ["100", "200"],
            "2026-07-29T12:00:00+02:00",
        )

    def test_does_not_reconcile_an_incomplete_newer_snapshot(self):
        connection = _FakeConnection(
            fetches=[
                (42, "2026-07-29", "2026-07-29T12:00:00+02:00"),
                (["100"], 1),
            ]
        )

        with patch("observer.storage.migrate_legacy_history._reconcile_active_roster") as reconcile:
            _reconcile_against_newer_snapshot(connection)

        reconcile.assert_not_called()


class _FakeCursor:
    def __init__(self, fetches):
        self.fetches = iter(fetches)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, _query, _parameters):
        return None

    def fetchone(self):
        return next(self.fetches)


class _FakeConnection:
    def __init__(self, fetches):
        self.cursor_instance = _FakeCursor(fetches)

    def cursor(self):
        return self.cursor_instance


if __name__ == "__main__":
    unittest.main()
