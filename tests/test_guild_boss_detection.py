import tempfile
import unittest
from pathlib import Path

from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.pipeline.guild_boss import detect_boss_ranking_rows
from observer.pipeline.guild_boss import _damage_text_from_ocr
from observer.pipeline.guild_boss import _display_name_for_match
from observer.pipeline.guild_boss import _match_roster_name
from observer.pipeline.guild_boss import _repair_rank_damage_order
from observer.pipeline.guild_boss import _supported_ocr_languages
from observer.pipeline.guild_boss import _useful_raw_name
from observer.pipeline.guild_boss import export_boss_ranking_crops
from observer.pipeline.guild_boss import format_boss_damage
from observer.pipeline.guild_boss import parse_boss_damage

try:
    from PIL import Image
except ImportError:  # pragma: no cover - exercised only outside the Nix dev shell/checks
    Image = None


FIXTURE = Path("screenshots/raw/2026-07-16/boss/boss-001.png")


class GuildBossDamageTests(unittest.TestCase):
    def test_filters_uninstalled_tesseract_languages(self) -> None:
        class FakeTesseract:
            @staticmethod
            def get_languages(*, config: str) -> list[str]:
                self.assertEqual(config, "")
                return ["eng", "osd"]

        self.assertEqual(
            _supported_ocr_languages(FakeTesseract(), ("eng", "eng+chi_tra", "rus")),
            ("eng",),
        )

    def test_falls_back_to_english_when_no_requested_language_is_installed(self) -> None:
        class FakeTesseract:
            @staticmethod
            def get_languages(*, config: str) -> list[str]:
                return ["eng"]

        self.assertEqual(
            _supported_ocr_languages(FakeTesseract(), ("chi_tra", "chi_sim", "rus")),
            ("eng",),
        )

    def test_parses_boss_damage_units(self) -> None:
        self.assertEqual(parse_boss_damage("354.44 billion"), 354_440_000_000)
        self.assertEqual(parse_boss_damage("38.35 billions"), 38_350_000_000)
        self.assertEqual(parse_boss_damage("1.25T"), 1_250_000_000_000)
        self.assertEqual(parse_boss_damage(".1 billion"), 100_000_000)
        self.assertEqual(parse_boss_damage("443.65 million"), 443_650_000)
        self.assertIsNone(parse_boss_damage("bad"))

    def test_formats_boss_damage_for_display(self) -> None:
        self.assertEqual(format_boss_damage(1_250_000_000_000), "1.25T")
        self.assertEqual(format_boss_damage(354_440_000_000), "354.44B")
        self.assertEqual(format_boss_damage(100_000_000), "100M")
        self.assertEqual(format_boss_damage(None, fallback_text=".1 billion"), "0.1B")
        self.assertEqual(format_boss_damage(None, fallback_text="623.60 billion"), "623.60B")
        self.assertEqual(format_boss_damage(None), "Not recorded")

    def test_normalizes_noisy_boss_damage_ocr(self) -> None:
        self.assertEqual(_damage_text_from_ocr("5 623.60B"), "623.60B")
        self.assertEqual(_damage_text_from_ocr("13.14B7"), "13.14B")
        self.assertEqual(_damage_text_from_ocr("2.50T"), "2.50T")
        self.assertEqual(_damage_text_from_ocr("13.878"), "13.87B")
        self.assertEqual(_damage_text_from_ocr("13.878B"), "13.87B")

    def test_repairs_rank_damage_unit_when_lower_rank_exceeds_previous(self) -> None:
        rankings = [
            ExtractedBossRanking("boss row 0", 0, "list", 27, "119991048", "Surrealism", "Surrealism", "468.31M", 468_310_000),
            ExtractedBossRanking("boss row 1", 1, "list", 28, "119961249", "Tristonn", "Tristonn", "421.21T", 421_210_000_000_000),
        ]

        repaired = _repair_rank_damage_order(rankings)

        self.assertEqual(repaired[1].damage_text, "421.21M")
        self.assertEqual(repaired[1].boss_damage_today, 421_210_000)

    def test_repairs_implausible_billion_to_million_ocr_drop(self) -> None:
        rankings = [
            ExtractedBossRanking("podium 2", 1, "podium", 2, None, "godforlin", "godforlin", "23.91B", 23_910_000_000),
            ExtractedBossRanking("podium 3", 2, "podium", 3, None, "Inf3rn4l", "Inf3rn4l", "215.71M", 215_710_000),
            ExtractedBossRanking("boss row 0", 0, "list", 4, None, "bolby", "bolby", "12.45M", 12_450_000),
            ExtractedBossRanking("boss row 1", 1, "list", 5, None, "Deathlinger", "Deathlinger", "12.30M", 12_300_000),
        ]

        repaired = _repair_rank_damage_order(rankings)

        self.assertEqual(repaired[1].damage_text, "15.71B")
        self.assertEqual(repaired[2].damage_text, "12.45B")
        self.assertEqual(repaired[3].damage_text, "12.30B")

    def test_upgrades_previous_unit_when_rank_order_proves_it_is_wrong(self) -> None:
        rankings = [
            ExtractedBossRanking("rank 23", 22, "list", 23, None, "A", "A", "1.45B", 1_450_000_000),
            ExtractedBossRanking("rank 24", 23, "list", 24, None, "B", "B", "1.13M", 1_130_000),
            ExtractedBossRanking("rank 25", 24, "list", 25, None, "C", "C", "848.45M", 848_450_000),
        ]

        repaired = _repair_rank_damage_order(rankings)

        self.assertEqual(repaired[1].damage_text, "1.13B")
        self.assertEqual(repaired[1].boss_damage_today, 1_130_000_000)

    def test_repairs_a_contiguous_block_of_missing_billion_units(self) -> None:
        rankings = [
            ExtractedBossRanking("rank 20", 19, "list", 20, None, "A", "A", "1.44M", 1_440_000),
            ExtractedBossRanking("rank 21", 20, "list", 21, None, "B", "B", "1.39M", 1_390_000),
            ExtractedBossRanking("rank 22", 21, "list", 22, None, "C", "C", "1.16M", 1_160_000),
            ExtractedBossRanking("rank 23", 22, "list", 23, None, "D", "D", "1.15M", 1_150_000),
            ExtractedBossRanking("rank 24", 23, "list", 24, None, "E", "E", "1.13M", 1_130_000),
            ExtractedBossRanking("rank 25", 24, "list", 25, None, "F", "F", "848.45M", 848_450_000),
        ]

        repaired = _repair_rank_damage_order(rankings)

        self.assertEqual(
            [ranking.damage_text for ranking in repaired],
            ["1.44B", "1.39B", "1.16B", "1.15B", "1.13B", "848.45M"],
        )

    def test_restores_missing_leading_damage_digit_from_rank_order(self) -> None:
        rankings = [
            ExtractedBossRanking("rank 1", 0, "podium", 1, None, "A", "A", "368.02B", 368_020_000_000),
            ExtractedBossRanking("rank 2", 1, "podium", 2, None, "B", "B", "7.21B", 7_210_000_000),
            ExtractedBossRanking("rank 4", 3, "list", 4, None, "D", "D", "13.23B", 13_230_000_000),
        ]

        repaired = _repair_rank_damage_order(rankings)

        self.assertEqual(repaired[1].damage_text, "17.21B")
        self.assertEqual(repaired[2].damage_text, "13.23B")

    def test_infers_a_missing_first_list_rank_from_the_following_rows(self) -> None:
        rankings = [
            ExtractedBossRanking("row 0", 0, "list", None, None, "A", "A", "5.03B", 5_030_000_000),
            ExtractedBossRanking("row 1", 1, "list", 10, None, "B", "B", "4.20B", 4_200_000_000),
            ExtractedBossRanking("row 2", 2, "list", 11, None, "C", "C", "3.71B", 3_710_000_000),
        ]

        repaired = _repair_rank_damage_order(rankings)

        self.assertEqual([ranking.boss_rank for ranking in repaired], [9, 10, 11])

    def test_keeps_valid_trillion_top_rank(self) -> None:
        rankings = [
            ExtractedBossRanking("boss podium 1", 0, "podium", 1, "119934456", "Sendrock", "Sendrock", "2.50T", 2_500_000_000_000),
            ExtractedBossRanking("boss podium 2", 1, "podium", 2, "119964574", "godforlin", "godforlin", "623.49B", 623_490_000_000),
        ]

        repaired = _repair_rank_damage_order(rankings)

        self.assertEqual(repaired[0].damage_text, "2.50T")
        self.assertEqual(repaired[0].boss_damage_today, 2_500_000_000_000)

    def test_does_not_match_tiny_podium_name_noise(self) -> None:
        class Entry:
            player_id = "1"
            name = "anxiety"

        self.assertIsNone(_match_roster_name("e |", [Entry()]))

    def test_matches_cjk_roster_names(self) -> None:
        class Entry:
            player_id = "1"
            name = "斯斯雞預料"

        self.assertIsNotNone(_match_roster_name("| 斯 斯 雞 預 料 ﹒ 沙", [Entry()]))

    def test_matches_cyrillic_roster_names(self) -> None:
        class Entry:
            player_id = "1"
            name = "Алхимик"

        self.assertIsNotNone(_match_roster_name("! АЛХИМИК 4", [Entry()]))

    def test_rejects_weak_latin_false_positive(self) -> None:
        class Entry:
            player_id = "1"
            name = "Ayumaki"

        self.assertIsNone(_match_roster_name("ANXUMUK", [Entry()]))

    def test_does_not_match_a_short_name_fragment(self) -> None:
        class Entry:
            player_id = "1"
            name = "Deathlinger"

        self.assertIsNone(_match_roster_name("Linger", [Entry()]))

    def test_cleans_noisy_boss_names(self) -> None:
        self.assertEqual(_useful_raw_name("] GjjTigerTiger »"), "GjjTigerTiger")
        self.assertEqual(_useful_raw_name("] Blacksynde “ 传"), "Blacksynde")
        self.assertEqual(_useful_raw_name("I? Brandontrandon tff"), "Brandontrandon")

    def test_rejects_multi_token_podium_noise(self) -> None:
        self.assertIsNone(_useful_raw_name("E'OJMOIM————‘—.._O‘Uln,—.—J.,u‘{lvﬂJ'”ﬂ.I"))

    def test_keeps_repeated_character_from_reliable_ocr_name(self) -> None:
        class Entry:
            player_id = "1"
            name = "GjTigerTiger"

        self.assertEqual(_display_name_for_match((Entry(), "] GjjTigerTiger »"), ""), "GjjTigerTiger")


@unittest.skipIf(Image is None, "Pillow is required for guild boss detection tests")
@unittest.skipUnless(FIXTURE.exists(), "guild boss screenshot fixture is missing")
class GuildBossDetectionTests(unittest.TestCase):
    def test_detects_visible_boss_ranking_rows(self) -> None:
        rows = detect_boss_ranking_rows(FIXTURE)

        self.assertEqual(len(rows), 7)
        self.assertEqual((rows[0].bounds.x, rows[0].bounds.y, rows[0].bounds.width, rows[0].bounds.height), (42, 873, 996, 152))
        self.assertEqual((rows[6].bounds.x, rows[6].bounds.y, rows[6].bounds.width, rows[6].bounds.height), (42, 1893, 996, 151))

    def test_detects_rows_after_uniform_resolution_scaling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            scaled_path = Path(directory) / "boss-1440.png"
            with Image.open(FIXTURE) as image:
                image.resize(
                    (round(image.width * 4 / 3), round(image.height * 4 / 3)),
                    Image.Resampling.NEAREST,
                ).save(scaled_path)

            rows = detect_boss_ranking_rows(scaled_path)

        self.assertEqual(len(rows), 7)
        self.assertAlmostEqual(rows[0].bounds.height, 152, delta=2)

    def test_infers_boss_ranking_field_regions(self) -> None:
        row = detect_boss_ranking_rows(FIXTURE)[0]

        self.assertEqual((row.fields.rank.x, row.fields.rank.y), (72, 891))
        self.assertEqual((row.fields.name.x, row.fields.name.y), (341, 885))
        self.assertEqual((row.fields.damage.x, row.fields.damage.y), (809, 913))

    def test_exports_row_and_field_crops(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            written = export_boss_ranking_crops(FIXTURE, output_dir)

            self.assertTrue((output_dir / "boss-row-00.png").exists())
            self.assertTrue((output_dir / "boss-row-00-name.png").exists())
            self.assertTrue((output_dir / "boss-row-00-damage.png").exists())
            self.assertEqual(len(written), 35)


if __name__ == "__main__":
    unittest.main()
