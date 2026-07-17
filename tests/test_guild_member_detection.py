import unittest
import tempfile
from pathlib import Path

from observer.pipeline.guild_members import detect_member_rows, export_member_row_crops

try:
    from PIL import Image
except ImportError:  # pragma: no cover - exercised only outside the Nix dev shell/checks
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

    def test_infers_pignouf_field_regions(self) -> None:
        pignouf = detect_member_rows(FIXTURE)[1]

        self.assertEqual((pignouf.fields.name.x, pignouf.fields.name.y), (423, 1007))
        self.assertEqual((pignouf.fields.power.x, pignouf.fields.power.y), (240, 1077))
        self.assertEqual((pignouf.fields.power_value.x, pignouf.fields.power_value.y), (312, 1077))
        self.assertEqual((pignouf.fields.boss_tries.x, pignouf.fields.boss_tries.y), (471, 1075))
        self.assertEqual((pignouf.fields.boss_tries_value.x, pignouf.fields.boss_tries_value.y), (528, 1075))
        self.assertEqual((pignouf.fields.donation.x, pignouf.fields.donation.y), (711, 1074))
        self.assertEqual((pignouf.fields.donation_value.x, pignouf.fields.donation_value.y), (744, 1074))

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
