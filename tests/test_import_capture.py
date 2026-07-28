import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from observer.import_capture import (
    ImportedScreenshot,
    ImportValidationError,
    _unique_boss_rankings,
    _write_text_atomic,
    import_lock,
    import_capture_day,
    latest_capture_date,
    read_roster_entries,
    validate_extracted_import,
)
from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics, RosterEntry


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
    def test_read_roster_entries_excludes_departed_members(self) -> None:
        sample = """export const guildRoster = [
  { playerId: "active-1", name: "Active", discordLinked: true },
  { playerId: "left-1", name: "Former", status: "left", leftAt: "2026-07-25" },
  { playerId: "kicked-1", name: "Removed", status: "kicked", leftAt: "2026-07-14" },
  { playerId: null, name: "Unknown", status: "kicked" },
];

export const memberSnapshots = [
  screenshotMember("active-1", "member", 123000, 100, 2, 0, "capture.png"),
  screenshotMember("left-1", "member", 456000, 100, 2, 0, "capture.png"),
];
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample-data.js"
            path.write_text(sample, encoding="utf-8")

            roster = read_roster_entries(path)

        self.assertEqual(
            roster,
            [RosterEntry(player_id="active-1", name="Active", power_hint=123_000)],
        )

    def test_validation_rejects_detected_rows_with_empty_ocr(self) -> None:
        with self.assertRaisesRegex(ImportValidationError, "boss OCR extracted 0"):
            validate_extracted_import(
                member_screenshots=[],
                boss_screenshots=[ImportedScreenshot("boss.png", "guild-boss", 8)],
                extracted_metrics=[],
                boss_rankings=[],
            )

    def test_validation_accepts_duplicate_sticky_boss_rank(self) -> None:
        duplicate = ExtractedBossRanking("boss.png", 0, "list", 8, "1", "Player", "Player", "4.2B", 4_200_000_000)
        validate_extracted_import(
            member_screenshots=[],
            boss_screenshots=[ImportedScreenshot("boss.png", "guild-boss", 2)],
            extracted_metrics=[],
            boss_rankings=[duplicate, duplicate],
        )

    def test_validation_warns_about_internal_boss_rank_gaps(self) -> None:
        quality = validate_extracted_import(
            member_screenshots=[],
            boss_screenshots=[ImportedScreenshot("boss.png", "guild-boss", 2)],
            extracted_metrics=[],
            boss_rankings=[
                ExtractedBossRanking("rank 1", 0, "podium", 1, "1", "A", "A", "10B", 10_000_000_000),
                ExtractedBossRanking("rank 3", 2, "podium", 3, "3", "C", "C", "8B", 8_000_000_000),
            ],
        )

        self.assertEqual(quality["status"], "accepted_with_warnings")
        self.assertIn("missing rank(s) 2", quality["warnings"][0])

    def test_deduplicated_boss_rankings_repair_ocr_unit_order(self) -> None:
        rankings = [
            ExtractedBossRanking("rank 23", 22, "list", 23, "23", "A", "A", "1.45B", 1_450_000_000),
            ExtractedBossRanking("rank 24 first", 23, "list", 24, "24", "B", "B", "1.13M", 1_130_000),
            ExtractedBossRanking("rank 24 duplicate", 23, "list", 24, None, None, None, "1.13B", 1_130_000_000),
            ExtractedBossRanking("rank 25", 24, "list", 25, "25", "C", "C", "848.45M", 848_450_000),
        ]

        unique = _unique_boss_rankings(rankings)

        self.assertEqual([ranking.boss_rank for ranking in unique], [23, 24, 25])
        self.assertEqual(unique[1].damage_text, "1.13B")

    def test_validation_rejects_low_member_coverage(self) -> None:
        metric = ExtractedMemberMetrics(
            player_id="1",
            name="One",
            role="member",
            power=100_000,
            donation=100,
            boss_tries=2,
            last_activity_days=0,
            source="members.png row 0",
            match_score=1,
            raw_name="One",
        )
        with self.assertRaisesRegex(ImportValidationError, "coverage is only"):
            validate_extracted_import(
                member_screenshots=[ImportedScreenshot("members.png", "guild-members", 10)],
                boss_screenshots=[],
                extracted_metrics=[metric],
                boss_rankings=[],
            )

    def test_validation_rejects_incomplete_capture_against_full_roster(self) -> None:
        metrics = [
            ExtractedMemberMetrics(
                player_id=str(index),
                name=f"Member {index}",
                role="member",
                power=100_000,
                donation=100,
                boss_tries=2,
                last_activity_days=0,
                source=f"members.png row {index}",
                match_score=1,
                raw_name=f"Member {index}",
            )
            for index in range(21)
        ]
        with self.assertRaisesRegex(ImportValidationError, "incomplete guild capture"):
            validate_extracted_import(
                member_screenshots=[ImportedScreenshot("members.png", "guild-members", 28)],
                boss_screenshots=[],
                extracted_metrics=metrics,
                boss_rankings=[],
                expected_member_count=38,
            )

    def test_import_lock_rejects_same_day_concurrency(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            imports_root = Path(directory)
            with import_lock(imports_root, "2026-07-22"):
                with self.assertRaisesRegex(RuntimeError, "already running"):
                    with import_lock(imports_root, "2026-07-22"):
                        pass

    def test_database_failure_restores_dashboard_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-22" / "guild"
            raw_dir.mkdir(parents=True)
            (raw_dir / "members-001.png").write_bytes(b"member")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA, encoding="utf-8")
            original = sample_data.read_text(encoding="utf-8")
            metric = ExtractedMemberMetrics(
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

            with (
                patch("observer.import_capture.detect_member_rows", return_value=[object()]),
                patch("observer.import_capture.extract_member_metrics_from_screenshots", return_value=[metric]),
                patch("observer.storage.persistence.persist_import_if_configured", side_effect=RuntimeError("database failed")),
                self.assertRaisesRegex(RuntimeError, "database failed"),
            ):
                import_capture_day(
                    "2026-07-22",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                )

            self.assertEqual(sample_data.read_text(encoding="utf-8"), original)
            self.assertFalse((root / "data" / "imports" / "2026-07-22.json").exists())
            self.assertEqual(len(list((root / "data" / "backups" / "imports" / "2026-07-22").glob("*.js"))), 1)

    def test_validation_failure_never_updates_front_or_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "screenshots" / "raw" / "2026-07-29" / "guild"
            raw_dir.mkdir(parents=True)
            (raw_dir / "members-001.png").write_bytes(b"member")
            sample_data = root / "web" / "sample-data.js"
            sample_data.parent.mkdir()
            sample_data.write_text(SAMPLE_DATA, encoding="utf-8")

            with (
                patch("observer.import_capture.detect_member_rows", return_value=[object()]),
                patch("observer.import_capture.extract_member_metrics_from_screenshots", return_value=[]),
                patch(
                    "observer.import_capture.validate_extracted_import",
                    side_effect=ImportValidationError("incomplete capture"),
                ),
                patch("observer.import_capture.update_sample_data") as update_front,
                patch("observer.storage.persistence.persist_import_if_configured") as persist,
                self.assertRaisesRegex(ImportValidationError, "incomplete capture"),
            ):
                import_capture_day(
                    "2026-07-29",
                    raw_root=root / "screenshots" / "raw",
                    imports_root=root / "data" / "imports",
                    sample_data_path=sample_data,
                )

            update_front.assert_not_called()
            persist.assert_not_called()
            self.assertFalse((root / "data" / "imports" / "2026-07-29.json").exists())

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
                patch("observer.import_capture.extract_boss_rankings_from_screenshots", return_value=[]),
                patch("observer.import_capture.validate_extracted_import", return_value={"status": "accepted", "warnings": [], "errors": []}),
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
        self.assertIn("export const dailyBossRawSnapshots = [", content)
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
                patch("observer.import_capture.extract_boss_rankings_from_screenshots", return_value=[]),
                patch("observer.import_capture.validate_extracted_import", return_value={"status": "accepted", "warnings": [], "errors": []}),
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
        self.assertIn("export const dailyBossRawSnapshots = [", content)

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
                patch("observer.import_capture.extract_boss_rankings_from_screenshots", return_value=[]),
                patch("observer.import_capture.validate_extracted_import", return_value={"status": "accepted", "warnings": [], "errors": []}),
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
