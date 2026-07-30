import re
import unittest
from pathlib import Path

from observer.storage.export_json import _jsonable, _member_snapshot_row


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "observer" / "storage" / "schema.sql"


class StorageSchemaTests(unittest.TestCase):
    def test_schema_contains_core_tables_and_views(self) -> None:
        schema = SCHEMA_PATH.read_text(encoding="utf-8")

        for name in [
            "app_users",
            "guild_members",
            "member_names",
            "boss_definitions",
            "capture_batches",
            "screenshots",
            "import_reports",
            "remote_import_batches",
            "guild_snapshots",
            "member_metrics",
            "unmatched_member_metrics",
            "boss_daily_results",
            "rule_settings",
            "ocr_failures",
            "automation_runs",
        ]:
            self.assertRegex(schema, rf"CREATE TABLE IF NOT EXISTS {name}\b")

        for name in [
            "v_member_latest_metrics",
            "v_boss_daily_leaderboard",
            "v_boss_personal_bests_global",
            "v_boss_personal_bests_by_boss",
            "v_boss_weekly_totals",
        ]:
            self.assertRegex(schema, rf"CREATE OR REPLACE VIEW {name}\b")

    def test_boss_rotation_seed_matches_week(self) -> None:
        schema = SCHEMA_PATH.read_text(encoding="utf-8")
        boss_keys = re.findall(r"\('([^']+)', \d, '[A-Z][a-z]{2}', '[^']+', '/bosses/[^']+\.png'", schema)

        self.assertEqual(
            boss_keys,
            [
                "treant-guardian",
                "fire-dragon",
                "flame-demon",
                "medusa",
                "stoneman",
                "cyclops-mage",
                "grim-reaper",
            ],
        )

    def test_boss_results_keep_one_rank_per_boss_day(self) -> None:
        schema = SCHEMA_PATH.read_text(encoding="utf-8")

        self.assertIn("boss_daily_results_rank_uidx", schema)
        self.assertIn("ON boss_daily_results (capture_date, boss_key, boss_rank)", schema)
        self.assertIn("WHERE boss_rank IS NOT NULL", schema)

    def test_export_normalizes_database_bytes_to_text(self) -> None:
        self.assertEqual(_jsonable({"name": b"Mund\xc3\xb5", "rows": [b"active"]}), {"name": "Mundõ", "rows": ["active"]})

    def test_member_export_preserves_precise_activity_text(self) -> None:
        row = {
            "user_id": "120015103",
            "current_name": "anxiety",
            "capture_date": "2026-07-28",
            "role": "member",
            "power": 1_420_000,
            "contribution_7d": 0,
            "boss_attacks": 0,
            "last_activity_days": 1,
            "verification_note": "members-007.png row 0",
            "raw_payload": {
                "activity_text": "1 d 10 h",
                "source": "members-007.png row 0",
                "raw_name": "anxlety",
                "match_score": 0.88,
            },
        }

        exported = _member_snapshot_row(row)
        self.assertEqual(exported["activityText"], "1 d 10 h")
        self.assertEqual(exported["source"], "members-007.png row 0")
        self.assertEqual(exported["rawName"], "anxlety")
        self.assertEqual(exported["detectedName"], "anxlety")
        self.assertEqual(exported["matchScore"], 0.88)

    def test_member_export_prefers_a_detected_chinese_name(self) -> None:
        row = {
            "user_id": None,
            "current_name": "Bh Bh 28 FA .",
            "capture_date": "2026-07-28",
            "role": "member",
            "power": 1_160_000,
            "contribution_7d": 1_400,
            "boss_attacks": 2,
            "last_activity_days": 0,
            "verification_note": "members-007.png row 1",
            "raw_payload": {
                "name": "斯斯雞預料",
                "raw_name": "斯斯雞預料 | Bh Bh 28 FA .",
            },
        }

        self.assertEqual(_member_snapshot_row(row)["detectedName"], "斯斯雞預料")


if __name__ == "__main__":
    unittest.main()
