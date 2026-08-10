import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from archero_guild.pipeline.guild_stats import extract_guild_stats_from_screenshot, parse_guild_stats_text
from archero_guild.storage.ingest_batch import BatchIngestionError, _validate_guild_stats


class GuildStatsTests(unittest.TestCase):
    def test_parses_labeled_guild_overview_text(self) -> None:
        result = parse_guild_stats_text("""
            Guild Name: Les Archers
            Guild ID: FR-2048
            Guild Level: 12
            Members: 38 / 40
            Total Power: 52.4M
            Donations: 12.5K
            Guild Rank: #73
            XP: 1.2M / 2M
        """)

        self.assertEqual(result["guildName"], "Les Archers")
        self.assertEqual(result["memberCount"], 38)
        self.assertEqual(result["memberCapacity"], 40)
        self.assertEqual(result["totalPower"], 52_400_000)
        self.assertEqual(result["xpRequired"], 2_000_000)

    def test_rejects_member_count_above_capacity(self) -> None:
        with self.assertRaises(BatchIngestionError):
            _validate_guild_stats({"memberCount": 41, "memberCapacity": 40})

    def test_screenshot_extraction_marks_incomplete_overview_for_review(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "guild.png"
            Image.new("RGB", (100, 100), "white").save(path)
            with patch(
                "pytesseract.image_to_string",
                return_value="Guild Name: Les Archers\nMembers: 38 / 40",
            ):
                result = extract_guild_stats_from_screenshot(path)

        self.assertEqual(result["quality"]["status"], "review")
        self.assertIn("level", result["quality"]["missingFields"])


if __name__ == "__main__":
    unittest.main()
