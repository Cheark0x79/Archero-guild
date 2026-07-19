import re
import unittest
from pathlib import Path


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
            "guild_snapshots",
            "member_metrics",
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


if __name__ == "__main__":
    unittest.main()
