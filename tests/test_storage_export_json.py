import unittest
from datetime import date

from observer.storage.export_json import _member_snapshot_row, _previous_names, _search_aliases


class StorageExportJsonTests(unittest.TestCase):
    def test_latest_member_snapshot_derives_real_deltas(self) -> None:
        previous = {
            "user_id": "123",
            "current_name": "Alice",
            "capture_date": date(2026, 7, 20),
            "power": 1_000,
            "contribution_7d": 500,
            "boss_attacks": 1,
        }
        current = {
            "user_id": "123",
            "current_name": "Alice",
            "capture_date": date(2026, 7, 22),
            "role": "member",
            "power": 1_100,
            "contribution_7d": 650,
            "boss_attacks": 2,
            "boss_damage_today": 900,
            "last_activity_days": 0,
        }

        snapshot = _member_snapshot_row(current, previous_row=previous, history=[previous, current])

        self.assertEqual(snapshot["powerDelta"], 100)
        self.assertEqual(snapshot["contributionDelta"], 150)
        self.assertEqual(snapshot["bossAttacksDelta"], 1)
        self.assertEqual(snapshot["bossDamageToday"], 900)

    def test_missing_history_stays_unknown_instead_of_becoming_zero(self) -> None:
        current = {
            "user_id": "123",
            "current_name": "Alice",
            "capture_date": date(2026, 7, 22),
            "role": "member",
            "power": 1_100,
            "contribution_7d": 650,
            "boss_attacks": 2,
        }

        snapshot = _member_snapshot_row(current, history=[current])

        self.assertIsNone(snapshot["powerDelta"])
        self.assertIsNone(snapshot["contributionDelta"])
        self.assertIsNone(snapshot["bossAttacksDelta"])
        self.assertIsNone(snapshot["power14dPercent"])

    def test_fourteen_day_power_growth_uses_database_history(self) -> None:
        baseline = {
            "user_id": "123",
            "capture_date": date(2026, 7, 1),
            "power": 1_000,
        }
        current = {
            "user_id": "123",
            "current_name": "Alice",
            "capture_date": date(2026, 7, 22),
            "role": "member",
            "power": 1_100,
        }

        snapshot = _member_snapshot_row(current, previous_row=baseline, history=[baseline, current])

        self.assertEqual(snapshot["power14dPercent"], 10.0)

    def test_member_search_metadata_is_normalized_without_duplicates(self) -> None:
        self.assertEqual(
            _previous_names("Alice", ["Old Alice", "Alice", " old alice ", "Alicia"]),
            ["Old Alice", "Alicia"],
        )
        self.assertEqual(
            _search_aliases(
                {
                    "searchAliases": ["Chef", " chef ", 42],
                    "search_aliases": "Leader",
                    "aliases": ["Guild Master"],
                }
            ),
            ["Chef", "Leader", "Guild Master"],
        )


if __name__ == "__main__":
    unittest.main()
