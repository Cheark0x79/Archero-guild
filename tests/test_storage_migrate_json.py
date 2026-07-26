import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics
from observer.storage.migrate_json import load_import_report, migrate_import_reports
from tests.test_import_capture import SAMPLE_DATA


class StorageMigrateJsonTests(unittest.TestCase):
    def test_load_import_report_rehydrates_import_screenshots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2026-07-16.json"
            path.write_text(json.dumps(_report_payload()), encoding="utf-8")

            report = load_import_report(path)

        self.assertEqual(report.date, "2026-07-16")
        self.assertEqual(report.member_screenshots[0].kind, "guild-members")
        self.assertEqual(report.member_screenshots[0].row_count, 1)
        self.assertEqual(report.boss_screenshots[0].kind, "guild-boss")

    def test_migrate_import_reports_dry_run_extracts_existing_reports_without_db(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            imports_root = root / "data" / "imports"
            imports_root.mkdir(parents=True)
            raw_dir = root / "screenshots" / "raw" / "2026-07-16"
            raw_dir.mkdir(parents=True)
            (raw_dir / "guild-members-001.png").write_bytes(b"member")
            (raw_dir / "guild-boss-001.png").write_bytes(b"boss")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA, encoding="utf-8")
            payload = _report_payload(
                member_path=str(raw_dir / "guild-members-001.png"),
                boss_path=str(raw_dir / "guild-boss-001.png"),
            )
            (imports_root / "2026-07-16.json").write_text(json.dumps(payload), encoding="utf-8")

            member_metric = ExtractedMemberMetrics(
                player_id="119945896",
                name="5m4",
                role="member",
                power=1_320_000,
                donation=2070,
                boss_tries=2,
                last_activity_days=0,
                source="guild-members-001.png row 0",
                match_score=0.98,
                raw_name="5m4",
            )
            boss_ranking = ExtractedBossRanking(
                source="guild-boss-001.png row 0",
                row_index=0,
                area="list",
                boss_rank=1,
                player_id="119945896",
                name="5m4",
                raw_name="5m4",
                damage_text="1.23B",
                boss_damage_today=1_230_000_000,
            )

            with (
                patch("observer.storage.migrate_json.extract_member_metrics_from_screenshots", return_value=[member_metric]),
                patch("observer.storage.migrate_json.extract_boss_rankings_from_screenshots", return_value=[boss_ranking]),
                patch(
                    "observer.storage.migrate_json.validate_extracted_import",
                    return_value={"status": "accepted", "warnings": [], "errors": []},
                ) as validate,
                patch("observer.storage.migrate_json.persist_import_report") as persist,
            ):
                result = migrate_import_reports(imports_root=imports_root, sample_data_path=sample_data, dry_run=True, with_ocr=True)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].date, "2026-07-16")
        self.assertEqual(result[0].member_metrics, 1)
        self.assertEqual(result[0].boss_rankings, 1)
        self.assertFalse(result[0].persisted)
        self.assertEqual(result[0].warnings, [])
        validate.assert_called_once()
        self.assertIn("expected_member_count", validate.call_args.kwargs)
        persist.assert_not_called()

    def test_migrate_import_reports_skips_ocr_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            imports_root = root / "data" / "imports"
            imports_root.mkdir(parents=True)
            raw_dir = root / "screenshots" / "raw" / "2026-07-16"
            raw_dir.mkdir(parents=True)
            (raw_dir / "guild-members-001.png").write_bytes(b"member")
            payload = _report_payload(member_path=str(raw_dir / "guild-members-001.png"))
            payload["boss_screenshots"] = []
            (imports_root / "2026-07-16.json").write_text(json.dumps(payload), encoding="utf-8")

            with patch("observer.storage.migrate_json.extract_member_metrics_from_screenshots") as extract:
                result = migrate_import_reports(imports_root=imports_root, dry_run=True)

        self.assertEqual(result[0].member_metrics, 0)
        self.assertIn("OCR skipped", result[0].warnings[0])
        extract.assert_not_called()

    def test_migrate_import_reports_requires_dsn_when_not_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            imports_root = Path(directory) / "data" / "imports"
            imports_root.mkdir(parents=True)

            with self.assertRaises(ValueError):
                migrate_import_reports(imports_root=imports_root, dsn=None, dry_run=False)


def _report_payload(member_path: str = "screenshots/raw/2026-07-16/guild-members-001.png", boss_path: str = "screenshots/raw/2026-07-16/guild-boss-001.png") -> dict[str, object]:
    return {
        "date": "2026-07-16",
        "captured_at": "2026-07-16T12:00:00+02:00",
        "raw_dir": "screenshots/raw/2026-07-16",
        "member_screenshots": [{"path": member_path, "kind": "guild-members", "row_count": 1}],
        "boss_screenshots": [{"path": boss_path, "kind": "guild-boss", "row_count": 1}],
        "detected_member_rows": 1,
        "detected_boss_rows": 1,
        "extracted_member_metrics": 1,
        "report_path": "data/imports/2026-07-16.json",
        "front_updated": True,
    }


if __name__ == "__main__":
    unittest.main()
