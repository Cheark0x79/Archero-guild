import unittest

from observer.pipeline.ranking import RankingRow, deduplicate_rows, should_stop_scrolling


class RankingTests(unittest.TestCase):
    def test_deduplicates_by_capture_key_before_user_id_is_known(self) -> None:
        rows = [
            RankingRow(rank=1, name="PlayerOne", score=481000000),
            RankingRow(rank=1, name=" playerone ", score=481000000),
            RankingRow(rank=2, name="Willy", score=375000000),
        ]

        self.assertEqual(deduplicate_rows(rows), [rows[0], rows[2]])

    def test_deduplicates_by_stable_user_id_when_known(self) -> None:
        rows = [
            RankingRow(rank=1, name="OldName", score=10, user_id="123456789"),
            RankingRow(rank=4, name="NewName", score=20, user_id="123456789"),
        ]

        self.assertEqual(deduplicate_rows(rows), [rows[0]])

    def test_stops_after_two_stagnant_captures(self) -> None:
        self.assertFalse(should_stop_scrolling(10, 11, 0))
        self.assertFalse(should_stop_scrolling(10, 10, 1))
        self.assertTrue(should_stop_scrolling(10, 10, 2))


if __name__ == "__main__":
    unittest.main()

