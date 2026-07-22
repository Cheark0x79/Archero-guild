import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from observer.import_capture import _write_text_atomic, import_capture_day, latest_capture_date
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics


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

SAMPLE_DATA_WITH_DAILY_17 = SAMPLE_DATA + """
function rawSnapshotMember(playerId, role, power, donation, bossAttacks, lastActivityDays, source, seenAt = null) {
  return { playerId, role, power, contribution7d: donation, bossAttacks, bossDamageToday: null, lastActivityDays, lastSeenAt: seenAt, verificationNote: `Screenshot check: ${source}.` };
}

export const dailyRawSnapshots = [
  {
    date: "2026-07-17",
    rows: [
    rawSnapshotMember("119945896", "member", 1340000, 2750, 2, 0, "members-004.png row 6", "2026-07-17"),
    ],
  },
];

function rawBossSnapshotRow(source, rowIndex, seenAt = null, data = {}) {
  return { source, rowIndex, area: data.area ?? "list", bossRank: data.bossRank ?? null, name: data.name ?? null, damageText: data.damageText ?? null, bossDamageToday: data.bossDamageToday ?? null, rowLabel: data.area === "podium" ? `Top ${data.bossRank ?? rowIndex + 1}` : `Boss row ${rowIndex + 1}`, lastSeenAt: seenAt };
}

export const dailyBossRawSnapshots = [
  {
    date: "2026-07-17",
    rows: [
      rawBossSnapshotRow("boss/boss-001.png row 0", 0, "2026-07-17", { area: "list" }),
    ],
  },
];
"""


class ImportCaptureTests(unittest.TestCase):
    def test_atomic_write_replaces_file_without_temp_leftover(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample-data.js"
            path.write_text("old", encoding="utf-8")

            _write_text_atomic(path, "new")

            self.assertEqual(path.read_text(encoding="utf-8"), "new")
            self.assertEqual(list(Path(directory).glob(".*.tmp")), [])

    def test_import_writes_report_and_updates_front_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-16"
            raw_dir.mkdir(parents=True)
            (raw_dir / "guild-members-001.png").write_bytes(b"one")
            (raw_dir / "guild-members-002.png").write_bytes(b"two")
            (raw_dir / "guild-boss-001.png").write_bytes(b"boss")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA, encoding="utf-8")

            with (
                patch("observer.import_capture.detect_member_rows", side_effect=[[object()] * 7, [object()] * 6]),
                patch("observer.import_capture.detect_boss_ranking_rows", side_effect=[[object()] * 8]),
                patch(
                    "observer.import_capture.extract_member_metrics_from_screenshots",
                    return_value=[
                        ExtractedMemberMetrics(
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
                    ],
                ),
            ):
                report = import_capture_day(
                    "2026-07-16",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                    captured_at="2026-07-16T12:00:00+02:00",
                )

            payload = json.loads((root / "data" / "imports" / "2026-07-16.json").read_text(encoding="utf-8"))
            content = sample_data.read_text(encoding="utf-8")

        self.assertEqual(report.detected_member_rows, 13)
        self.assertEqual(report.detected_boss_rows, 8)
        self.assertEqual(report.extracted_member_metrics, 1)
        self.assertEqual(payload["detected_member_rows"], 13)
        self.assertEqual(payload["detected_boss_rows"], 8)
        self.assertEqual(payload["extracted_member_metrics"], 1)
        self.assertIn('lastCapturedAt: "2026-07-15T21:56:31+02:00"', content)
        self.assertIn('lastImportedAt: "2026-07-16T12:00:00+02:00"', content)
        self.assertIn('screenshotMember("119945896", "member", 1320000, 2070, 2, 0, "guild-members-001.png row 0", "2026-07-16")', content)
        self.assertIn("function rawSnapshotMember(", content)
        self.assertIn("export const dailyRawSnapshots = [", content)
        self.assertIn('date: "2026-07-16"', content)
        self.assertIn('rawSnapshotMember("119945896", "member", 1320000, 2070, 2, 0, "guild-members-001.png row 0", "2026-07-16")', content)
        self.assertIn("function rawBossSnapshotRow(", content)
        self.assertIn("export const dailyBossRawSnapshots = [", content)
        self.assertIn('rawBossSnapshotRow("guild-boss-001.png podium 1", 0, "2026-07-16", { area: "podium", bossRank: 1 })', content)
        self.assertIn('rawBossSnapshotRow("guild-boss-001.png row 0", 0, "2026-07-16", { area: "list" })', content)
        self.assertIn('title: "2 guild screenshots imported"', content)
        self.assertIn("8 visible MI ranking rows", content)
        self.assertIn('at: "2026-07-16"', content)

    def test_import_inserts_last_imported_at_when_missing(self) -> None:
        sample_without_import = SAMPLE_DATA.replace('  lastImportedAt: "2026-07-15T22:00:00+02:00",\n', "")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-16"
            raw_dir.mkdir(parents=True)
            (raw_dir / "guild-boss-001.png").write_bytes(b"boss")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(sample_without_import, encoding="utf-8")

            with patch("observer.import_capture.detect_boss_ranking_rows", return_value=[]):
                import_capture_day(
                    "2026-07-16",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                    captured_at="2026-07-16T12:00:00+02:00",
                )

            content = sample_data.read_text(encoding="utf-8")

        self.assertIn('lastCapturedAt: "2026-07-15T21:56:31+02:00"', content)
        self.assertIn('lastImportedAt: "2026-07-16T12:00:00+02:00"', content)

    def test_import_reads_nested_capture_layout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-16"
            (raw_dir / "guild").mkdir(parents=True)
            (raw_dir / "boss").mkdir()
            (raw_dir / "guild" / "members-001.png").write_bytes(b"one")
            (raw_dir / "boss" / "boss-001.png").write_bytes(b"boss")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA, encoding="utf-8")

            with (
                patch("observer.import_capture.detect_member_rows", return_value=[object()]),
                patch("observer.import_capture.detect_boss_ranking_rows", return_value=[object(), object()]),
                patch("observer.import_capture.extract_member_metrics_from_screenshots", return_value=[]),
            ):
                report = import_capture_day(
                    "2026-07-16",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                    captured_at="2026-07-16T12:00:00+02:00",
                )

            content = sample_data.read_text(encoding="utf-8")

        self.assertEqual(report.detected_member_rows, 1)
        self.assertEqual(report.detected_boss_rows, 2)
        self.assertEqual(Path(report.member_screenshots[0].path).parts[-2:], ("guild", "members-001.png"))
        self.assertEqual(Path(report.boss_screenshots[0].path).parts[-2:], ("boss", "boss-001.png"))
        self.assertIn('rawBossSnapshotRow("boss/boss-001.png podium 1", 0, "2026-07-16", { area: "podium", bossRank: 1 })', content)
        self.assertIn('rawBossSnapshotRow("boss/boss-001.png row 0", 0, "2026-07-16", { area: "list" })', content)

    def test_import_preserves_daily_snapshots_for_other_dates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-16"
            (raw_dir / "guild").mkdir(parents=True)
            (raw_dir / "boss").mkdir()
            (raw_dir / "guild" / "members-001.png").write_bytes(b"one")
            (raw_dir / "boss" / "boss-001.png").write_bytes(b"boss")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA_WITH_DAILY_17, encoding="utf-8")

            with (
                patch("observer.import_capture.detect_member_rows", return_value=[object()]),
                patch("observer.import_capture.detect_boss_ranking_rows", return_value=[object()]),
                patch(
                    "observer.import_capture.extract_member_metrics_from_screenshots",
                    return_value=[
                        ExtractedMemberMetrics(
                            player_id="119945896",
                            name="5m4",
                            role="member",
                            power=1_320_000,
                            donation=2070,
                            boss_tries=2,
                            last_activity_days=0,
                            source="guild/members-001.png row 0",
                            match_score=0.98,
                            raw_name="5m4",
                        )
                    ],
                ),
            ):
                import_capture_day(
                    "2026-07-16",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                    captured_at="2026-07-16T12:00:00+02:00",
                )

            content = sample_data.read_text(encoding="utf-8")

        self.assertIn('date: "2026-07-16"', content)
        self.assertIn('date: "2026-07-17"', content)
        self.assertIn('rawSnapshotMember("119945896", "member", 1320000, 2070, 2, 0, "guild/members-001.png row 0", "2026-07-16")', content)
        self.assertIn('rawSnapshotMember("119945896", "member", 1340000, 2750, 2, 0, "members-004.png row 6", "2026-07-17")', content)
        self.assertIn('rawBossSnapshotRow("boss/boss-001.png row 0", 0, "2026-07-16", { area: "list" })', content)
        self.assertIn('rawBossSnapshotRow("boss/boss-001.png row 0", 0, "2026-07-17", { area: "list" })', content)

    def test_import_does_not_reprocess_older_daily_member_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for day in ("2026-07-14", "2026-07-15", "2026-07-16"):
                raw_dir = root / "screenshots" / "raw" / day / "guild"
                raw_dir.mkdir(parents=True)
                (raw_dir / "members-001.png").write_bytes(day.encode("utf-8"))
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA_WITH_DAILY_17, encoding="utf-8")

            current_metrics = [
                ExtractedMemberMetrics(
                    player_id="119945896",
                    name="5m4",
                    role="member",
                    power=1_320_000,
                    donation=2070,
                    boss_tries=2,
                    last_activity_days=0,
                    source="guild/members-001.png row 0",
                    match_score=0.98,
                    raw_name="5m4",
                )
            ]
            previous_metrics = [
                ExtractedMemberMetrics(
                    player_id="119945896",
                    name="5m4",
                    role="member",
                    power=1_300_000,
                    donation=1900,
                    boss_tries=2,
                    last_activity_days=0,
                    source="guild/members-001.png row 0",
                    match_score=0.98,
                    raw_name="5m4",
                )
            ]

            with (
                patch("observer.import_capture.detect_member_rows", return_value=[object()]),
                patch("observer.import_capture.extract_member_metrics_from_screenshots", side_effect=[current_metrics, previous_metrics]) as extract,
            ):
                import_capture_day(
                    "2026-07-16",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                    captured_at="2026-07-16T12:00:00+02:00",
                )

            content = sample_data.read_text(encoding="utf-8")

        self.assertEqual(extract.call_count, 2)
        self.assertIn('date: "2026-07-16"', content)
        self.assertIn('date: "2026-07-17"', content)

    def test_import_can_skip_front_update(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-16"
            raw_dir.mkdir(parents=True)
            (raw_dir / "guild-boss-001.png").write_bytes(b"boss")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA, encoding="utf-8")

            with patch("observer.import_capture.detect_boss_ranking_rows", return_value=[]):
                report = import_capture_day(
                    "2026-07-16",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                    captured_at="2026-07-16T12:00:00+02:00",
                    update_front=False,
                )

            content = sample_data.read_text(encoding="utf-8")

        self.assertFalse(report.front_updated)
        self.assertIn('lastCapturedAt: "2026-07-15T21:56:31+02:00"', content)
        self.assertIn('lastImportedAt: "2026-07-15T22:00:00+02:00"', content)

    def test_latest_capture_date_returns_newest_dated_folder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "2026-07-15").mkdir()
            (root / "not-a-date").mkdir()
            (root / "2026-07-16").mkdir()

            self.assertEqual(latest_capture_date(root), "2026-07-16")


if __name__ == "__main__":
    unittest.main()
