import tempfile
import unittest
from pathlib import Path

from observer.pipeline.guild_boss import detect_boss_ranking_rows
from observer.pipeline.guild_boss import _damage_text_from_ocr
from observer.pipeline.guild_boss import _display_name_for_match
from observer.pipeline.guild_boss import _match_roster_name
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

    def test_cleans_noisy_boss_names(self) -> None:
        self.assertEqual(_useful_raw_name("] GjjTigerTiger »"), "GjjTigerTiger")

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
