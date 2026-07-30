import unittest
import os
from dataclasses import replace
from unittest.mock import patch

from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics, RosterEntry
from observer.storage.persistence import (
    _dedupe_boss_rankings,
    _is_complete_member_roster,
    _reconcile_active_roster,
    persist_import_if_configured,
)


class StoragePersistenceTests(unittest.TestCase):
    def test_dedupe_boss_rankings_keeps_best_duplicate_rank(self) -> None:
        weak = _boss_ranking(rank=27, name=None, player_id=None, damage=None, raw_name="M")
        strong = _boss_ranking(rank=27, name="MedusaPlayer", player_id="123", damage=1_200_000_000, raw_name="MedusaPlayer")
        next_rank = _boss_ranking(rank=28, name="Other", player_id="456", damage=900_000_000, raw_name="Other")

        rankings = _dedupe_boss_rankings([weak, strong, next_rank])

        self.assertEqual([ranking.boss_rank for ranking in rankings], [27, 28])
        self.assertEqual(rankings[0].player_id, "123")
        self.assertEqual(rankings[0].boss_damage_today, 1_200_000_000)

    def test_dedupe_boss_rankings_keeps_unranked_rows(self) -> None:
        first = _boss_ranking(rank=None, name="Unknown A", player_id=None, damage=100, raw_name="Unknown A")
        second = _boss_ranking(rank=None, name="Unknown B", player_id=None, damage=200, raw_name="Unknown B")

        rankings = _dedupe_boss_rankings([first, second])

        self.assertEqual(len(rankings), 2)

    def test_persist_import_if_configured_skips_unavailable_database(self) -> None:
        with (
            patch("observer.storage.persistence.persist_import_report", side_effect=RuntimeError("connection refused")),
            patch("observer.storage.persistence._is_database_unavailable", return_value=True),
        ):
            persisted = persist_import_if_configured(
                _import_report(),
                roster=[],
                extracted_metrics=[],
                daily_boss_rankings={},
                dsn="postgresql://archero@127.0.0.1:55440/archero_observer",
            )

        self.assertFalse(persisted)

    def test_required_database_fails_closed(self) -> None:
        with (
            patch("observer.storage.persistence.persist_import_report", side_effect=RuntimeError("connection refused")),
            patch("observer.storage.persistence._is_database_unavailable", return_value=True),
            patch.dict(os.environ, {"ARCHERO_REQUIRE_DATABASE": "1"}),
            self.assertRaisesRegex(RuntimeError, "database persistence required"),
        ):
            persist_import_if_configured(
                _import_report(),
                roster=[],
                extracted_metrics=[],
                daily_boss_rankings={},
                dsn="postgresql://archero@postgres/archero_observer",
            )

    def test_only_a_complete_identified_member_roster_triggers_reconciliation(self) -> None:
        report = replace(
            _import_report(),
            detected_member_rows=1,
            extracted_member_metrics=1,
            quality={"coverage": 1},
        )
        roster = [RosterEntry(player_id="123", name="Player", power_hint=None)]
        metrics = [_member_metric(player_id="123")]

        self.assertTrue(_is_complete_member_roster(report, roster, metrics))
        self.assertFalse(_is_complete_member_roster(report, [], metrics))
        self.assertFalse(_is_complete_member_roster(report, roster, [_member_metric(player_id="")]))
        partial_report = replace(report, quality={"coverage": 0.975})
        self.assertFalse(_is_complete_member_roster(partial_report, roster, metrics))

    def test_reconciliation_marks_only_older_missing_active_members_left(self) -> None:
        cursor = _RecordingCursor()

        _reconcile_active_roster(cursor, ["123", "456"], "2026-07-29T12:00:00+02:00")

        query, parameters = cursor.calls[0]
        self.assertIn("status = 'active'", query)
        self.assertIn("last_seen_at <= %s::timestamptz", query)
        self.assertEqual(
            parameters,
            ("2026-07-29T12:00:00+02:00", "2026-07-29T12:00:00+02:00", ["123", "456"]),
        )


def _boss_ranking(*, rank: int | None, name: str | None, player_id: str | None, damage: int | None, raw_name: str | None) -> ExtractedBossRanking:
    return ExtractedBossRanking(
        source="guild-boss-001.png row 0",
        row_index=0,
        area="list",
        boss_rank=rank,
        player_id=player_id,
        name=name,
        raw_name=raw_name,
        damage_text=None,
        boss_damage_today=damage,
    )


def _import_report():
    from observer.import_capture import ImportReport

    return ImportReport(
        date="2026-07-21",
        captured_at="2026-07-21T00:00:00+02:00",
        raw_dir="screenshots/raw/2026-07-21",
        member_screenshots=[],
        boss_screenshots=[],
        detected_member_rows=0,
        detected_boss_rows=0,
        extracted_member_metrics=0,
        report_path="data/imports/2026-07-21.json",
        front_updated=True,
    )


def _member_metric(*, player_id: str) -> ExtractedMemberMetrics:
    return ExtractedMemberMetrics(
        player_id=player_id,
        name="Player",
        role="Member",
        power=1,
        donation=1,
        boss_tries=1,
        last_activity_days=0,
        source="guild-members-001.png row 0",
        match_score=1,
        raw_name="Player",
    )


class _RecordingCursor:
    def __init__(self):
        self.calls = []

    def execute(self, query, parameters):
        self.calls.append((query, parameters))


if __name__ == "__main__":
    unittest.main()
