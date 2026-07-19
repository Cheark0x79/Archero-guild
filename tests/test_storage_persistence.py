import unittest

from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.storage.persistence import _dedupe_boss_rankings


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


if __name__ == "__main__":
    unittest.main()
