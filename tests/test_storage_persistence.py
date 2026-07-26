import unittest
import os
from unittest.mock import patch

from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.storage.persistence import _dedupe_boss_rankings, persist_import_if_configured


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


if __name__ == "__main__":
    unittest.main()
