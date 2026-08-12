import unittest
import tempfile
from pathlib import Path

from archero_guild.pipeline.guild_members import detect_member_rows, export_member_row_crops

try:
    from PIL import Image
except ImportError:  # pragma: no cover - exercised only outside the OCR runtime
    Image = None


FIXTURE = Path("screenshots/raw/2026-07-16/guild-members-001.png")


@unittest.skipIf(Image is None, "Pillow is required for guild member detection tests")
@unittest.skipUnless(FIXTURE.exists(), "guild member screenshot fixture is missing")
class GuildMemberDetectionTests(unittest.TestCase):
    def test_detects_visible_member_rows_from_full_screenshot(self) -> None:
        rows = detect_member_rows(FIXTURE)

        self.assertEqual(len(rows), 7)
        self.assertEqual((rows[0].bounds.x, rows[0].bounds.y, rows[0].bounds.width, rows[0].bounds.height), (58, 806, 960, 151))
        self.assertEqual((rows[1].bounds.x, rows[1].bounds.y, rows[1].bounds.width, rows[1].bounds.height), (58, 983, 960, 151))
        self.assertEqual((rows[6].bounds.x, rows[6].bounds.y, rows[6].bounds.width, rows[6].bounds.height), (58, 1871, 960, 142))

    def test_detects_rows_after_uniform_resolution_scaling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            scaled_path = Path(directory) / "guild-members-1440.png"
            with Image.open(FIXTURE) as image:
                image.resize(
                    (round(image.width * 4 / 3), round(image.height * 4 / 3)),
                    Image.Resampling.NEAREST,
                ).save(scaled_path)

            rows = detect_member_rows(scaled_path)

        self.assertEqual(len(rows), 7)
        self.assertAlmostEqual(rows[0].bounds.height, 151, delta=2)

    def test_infers_second_member_field_regions(self) -> None:
        second_member = detect_member_rows(FIXTURE)[1]

        self.assertGreater(second_member.fields.name.x, second_member.fields.role.right)
        self.assertEqual(second_member.fields.name.y, 1004)
        self.assertEqual((second_member.fields.power.x, second_member.fields.power.y), (240, 1077))
        self.assertEqual((second_member.fields.power_value.x, second_member.fields.power_value.y), (322, 1066))
        self.assertEqual((second_member.fields.boss_tries.x, second_member.fields.boss_tries.y), (471, 1075))
        self.assertEqual((second_member.fields.boss_tries_value.x, second_member.fields.boss_tries_value.y), (528, 1068))
        self.assertEqual(second_member.fields.boss_tries_value.width, 144)
        self.assertEqual((second_member.fields.donation.x, second_member.fields.donation.y), (711, 1074))
        self.assertEqual((second_member.fields.donation_value.x, second_member.fields.donation_value.y), (749, 1068))

    def test_exports_row_and_field_crops(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            written = export_member_row_crops(FIXTURE, output_dir)

            self.assertTrue((output_dir / "row-01.png").exists())
            self.assertTrue((output_dir / "row-01-name.png").exists())
            self.assertTrue((output_dir / "row-01-power.png").exists())
            self.assertTrue((output_dir / "row-01-power_value.png").exists())
            self.assertTrue((output_dir / "row-01-boss_tries.png").exists())
            self.assertTrue((output_dir / "row-01-boss_tries_value.png").exists())
            self.assertTrue((output_dir / "row-01-donation.png").exists())
            self.assertTrue((output_dir / "row-01-donation_value.png").exists())
            self.assertEqual(len(written), 77)


if __name__ == "__main__":
    unittest.main()
