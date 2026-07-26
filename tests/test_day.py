import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from observer.day import main, run_day


SAMPLE_DATA = """export const captures = {
  lastCapturedAt: "2026-07-15T21:56:31+02:00",
  lastImportedAt: "2026-07-15T22:00:00+02:00",
  baselineJoinedAt: "2026-07-09",
};

export const changes = [
  {
    type: "capture",
    title: "old title",
    detail: "old detail",
    at: "2026-07-15",
  },
];

export const memberSnapshots = [
  screenshotMember("119945896", "member", 1300000, 2000, 1, 0, "old source"),
];
"""

class DayCommandTests(unittest.TestCase):
    def test_run_day_imports_existing_guild_and_boss_screenshots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-17"
            (raw_dir / "guild").mkdir(parents=True)
            (raw_dir / "boss").mkdir()
            (raw_dir / "guild" / "members-001.png").write_bytes(b"guild")
            (raw_dir / "boss" / "boss-001.png").write_bytes(b"boss")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA, encoding="utf-8")

            with (
                patch("observer.import_capture.detect_member_rows", return_value=[object()]),
                patch("observer.import_capture.detect_boss_ranking_rows", return_value=[object(), object()]),
                patch("observer.import_capture.extract_member_metrics_from_screenshots", return_value=[]),
                patch("observer.import_capture.extract_boss_rankings_from_screenshots", return_value=[]),
                patch("observer.import_capture.validate_extracted_import", return_value={"status": "accepted", "warnings": [], "errors": []}),
            ):
                report = run_day(
                    "2026-07-17",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                    captured_at="2026-07-17T00:05:00+02:00",
                )

            import_payload = json.loads((root / "data" / "imports" / "2026-07-17.json").read_text(encoding="utf-8"))
            content = sample_data.read_text(encoding="utf-8")

        self.assertEqual(report.date, "2026-07-17")
        self.assertEqual(import_payload["detected_member_rows"], 1)
        self.assertEqual(import_payload["detected_boss_rows"], 2)
        self.assertEqual(import_payload["member_screenshots"][0]["path"], (raw_dir / "guild" / "members-001.png").as_posix())
        self.assertEqual(import_payload["boss_screenshots"][0]["path"], (raw_dir / "boss" / "boss-001.png").as_posix())
        self.assertIn('lastImportedAt: "2026-07-17T00:05:00+02:00"', content)

    def test_cli_dry_run_does_not_capture_or_import(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stdout = StringIO()
            with redirect_stdout(stdout):
                exit_code = main(["2026-07-17", "--raw-root", str(root / "screenshots" / "raw"), "--dry-run"])

        self.assertEqual(exit_code, 0)
        self.assertFalse((root / "screenshots").exists())


if __name__ == "__main__":
    unittest.main()
