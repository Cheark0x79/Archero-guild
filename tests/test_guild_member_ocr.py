import unittest

from observer.pipeline.guild_member_ocr import (
    RosterEntry,
    _match_roster_name,
    _parse_visible_activity_days,
    _parse_role,
    _raw_name_has_signal,
    _select_integer_candidate,
    _select_power_candidate,
    _select_power_cluster,
    format_activity_text,
    format_game_power,
    format_role_text,
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

    def test_match_roster_name_removes_ui_prefixes_and_normalizes_zero(self) -> None:
        roster = [
            RosterEntry("1", "June00"),
            RosterEntry("2", "Jokowi"),
        ]

        self.assertEqual(_match_roster_name(["Members+ JuneOO"], roster)[0].player_id, "1")
        self.assertEqual(_match_roster_name(["bers? jokewi"], roster)[0].player_id, "2")

    def test_matches_a_cyrillic_member_name(self) -> None:
        roster = [RosterEntry("119933547", "Алхимик")]

        match = _match_roster_name(["АЛХИМИК |", "AJIXUMUK"], roster)

        self.assertIsNotNone(match)
        self.assertEqual(match[0].player_id, "119933547")
        self.assertEqual(match[2], "АЛХИМИК |")

    def test_readable_unknown_name_is_not_safe_for_power_fallback(self) -> None:
        self.assertTrue(_raw_name_has_signal("Members Brandontrandon"))
        self.assertFalse(_raw_name_has_signal(" | pers? aA | "))

    def test_empty_activity_area_means_member_is_online_today(self) -> None:
        self.assertEqual(_parse_visible_activity_days(""), 0)
        self.assertEqual(_parse_visible_activity_days("   "), 0)
        self.assertEqual(_parse_visible_activity_days("01d 05h"), 1)
        self.assertEqual(_parse_visible_activity_days("Old 10h"), 1)

    def test_formats_values_like_the_game_display(self) -> None:
        self.assertEqual(format_game_power(1_260_000), "1.26M")
        self.assertEqual(format_game_power(923_090), "923.09K")
        self.assertEqual(format_activity_text("Online", 0), "Online")
        self.assertEqual(format_activity_text("01d 05h", 1), "1 d 5 h")
        self.assertEqual(format_activity_text("02d 03h", 2), "2 d 3 h")
        self.assertEqual(format_activity_text("Old 10h", 1), "1 d 10 h")
        self.assertEqual(format_role_text("officer"), "Vice-leader")
        self.assertEqual(format_role_text("member"), "Guild member")

    def test_recognizes_all_guild_roles_and_common_vice_leader_noise(self) -> None:
        self.assertEqual(_parse_role("Leader"), "leader")
        self.assertEqual(_parse_role("Vice Leader"), "officer")
        self.assertEqual(_parse_role("Mice Leader?"), "officer")
        self.assertEqual(_parse_role("Elder"), "elder")
        self.assertEqual(_parse_role("Guild Members"), "member")
        self.assertEqual(_parse_role("_ Guild Memhers +"), "member")


if __name__ == "__main__":
    unittest.main()
