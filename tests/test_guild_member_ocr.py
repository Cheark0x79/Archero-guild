import unittest

from observer.pipeline.guild_member_ocr import (
    _select_integer_candidate,
    _select_power_candidate,
    _select_power_cluster,
    parse_power,
)


class GuildMemberOcrTests(unittest.TestCase):
    def test_parse_power_reads_game_power_units(self) -> None:
        self.assertEqual(parse_power("481.41K"), 481410)
        self.assertEqual(parse_power("5.01M"), 5_010_000)

    def test_select_power_candidate_prefers_repeated_ocr_value_over_average(self) -> None:
        candidates = [481410, 481410, 451410, 481410]

        self.assertEqual(_select_power_candidate(candidates), 481410)

    def test_select_power_candidate_uses_priority_order_when_values_are_close(self) -> None:
        cluster = [5_000_000, 5_001_000, 5_010_000]
        priority_order = [5_010_000, 5_000_000, 5_001_000]

        self.assertEqual(_select_power_candidate(cluster, priority_order), 5_010_000)

    def test_select_power_cluster_prefers_trusted_crop_over_icon_noise(self) -> None:
        candidates = [
            (5_010_000, True, True),
            (1_000_000, False, False),
            (2_010_000, False, True),
        ]

        self.assertEqual(_select_power_cluster(candidates), 5_010_000)

    def test_select_power_cluster_prefers_decimal_read_when_trusted_crop_loses_precision(self) -> None:
        candidates = [
            (1_000_000, True, False),
            (1_170_000, False, True),
        ]

        self.assertEqual(_select_power_cluster(candidates), 1_170_000)

    def test_select_integer_candidate_uses_most_common_value(self) -> None:
        candidates = [550, 850, 550, 0, 550]

        self.assertEqual(_select_integer_candidate(candidates), 550)


if __name__ == "__main__":
    unittest.main()
