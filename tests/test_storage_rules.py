import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from observer.storage.rules import _read_legacy_rules, read_rules


class StorageRulesTests(unittest.TestCase):
    def test_legacy_rules_are_available_for_one_time_database_migration(self) -> None:
        rules = {
            "maxInactiveDays": 4,
            "minContribution7d": 600,
            "minPowerGrowth14dPercent": 1.5,
            "minBossTries": 2,
            "newMemberGraceDays": 7,
            "memberCapacity": 40,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.json"
            path.write_text(json.dumps(rules), encoding="utf-8")
            with patch.dict(os.environ, {"ARCHERO_RULES_FILE": str(path)}):
                self.assertEqual(_read_legacy_rules(), rules)

    def test_invalid_legacy_rules_are_not_migrated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.json"
            path.write_text('{"memberCapacity": 40}', encoding="utf-8")
            with patch.dict(os.environ, {"ARCHERO_RULES_FILE": str(path)}):
                self.assertEqual(_read_legacy_rules(), {})

    def test_partial_database_rules_are_completed_from_legacy_values(self) -> None:
        legacy = {
            "maxInactiveDays": 4,
            "minContribution7d": 600,
            "minPowerGrowth14dPercent": 1.5,
            "minBossTries": 2,
            "newMemberGraceDays": 7,
            "memberCapacity": 40,
        }
        with (
            patch("observer.storage.rules._read_database_rules", return_value={"memberCapacity": 35}),
            patch("observer.storage.rules._read_legacy_rules", return_value=legacy),
            patch("observer.storage.rules.write_rules", side_effect=lambda _dsn, rules: rules) as write,
        ):
            rules = read_rules("postgresql://test")

        self.assertEqual(rules["memberCapacity"], 35)
        self.assertEqual(rules["minContribution7d"], 600)
        write.assert_called_once()

    def test_partial_database_rules_remain_explicit_when_no_legacy_file_exists(self) -> None:
        partial = {"memberCapacity": 35}
        with (
            patch("observer.storage.rules._read_database_rules", return_value=partial),
            patch("observer.storage.rules._read_legacy_rules", return_value={}),
        ):
            self.assertEqual(read_rules("postgresql://test"), partial)


if __name__ == "__main__":
    unittest.main()
