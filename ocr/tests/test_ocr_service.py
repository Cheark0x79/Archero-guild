from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from archero_guild.ocr.service import scan_image
from archero_guild.pipeline.guild_member_ocr import ExtractedMemberMetrics
from archero_guild.pipeline.guild_members import MemberRow, MemberRowFields, Rect

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


@unittest.skipIf(Image is None, "Pillow is required for OCR service tests")
class OcrServiceTests(unittest.TestCase):
    def test_member_contract_passes_only_with_complete_detected_rows(self) -> None:
        bounds = Rect(40, 600, 1000, 150)
        fields = MemberRowFields(
            avatar=bounds,
            role=bounds,
            name=bounds,
            power=bounds,
            power_value=bounds,
            boss_tries=bounds,
            boss_tries_value=bounds,
            donation=bounds,
            donation_value=bounds,
            status=bounds,
        )
        metric = ExtractedMemberMetrics(
            player_id="900000104",
            name="MapleFox",
            role="member",
            power=737250,
            donation=2030,
            boss_tries=2,
            last_activity_days=0,
            source="fixture row 0",
            match_score=0.99,
            raw_name="MapleFox",
            power_text="737.25K",
            activity_text="Online",
            role_text="Guild member",
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.png"
            Image.new("RGB", (1440, 2560)).save(path)
            with (
                patch("archero_guild.ocr.service._load_roster", return_value=[]),
                patch("archero_guild.ocr.service.detect_member_rows", return_value=[MemberRow(0, bounds, fields)]),
                patch("archero_guild.ocr.service.extract_member_metrics_from_screenshots", return_value=[metric]),
                patch("archero_guild.ocr.service._write_diagnostics"),
            ):
                result = scan_image(path, "guild-members")

        self.assertEqual(result["schemaVersion"], 1)
        self.assertEqual(result["quality"]["status"], "pass")
        self.assertEqual(result["quality"]["coverage"], 1)
        self.assertEqual(result["quality"]["completeness"], 1)
        self.assertEqual(result["normalization"]["canonicalWidth"], 1080)

    def test_empty_detection_is_never_publishable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.png"
            Image.new("RGB", (720, 1280)).save(path)
            with (
                patch("archero_guild.ocr.service._load_roster", return_value=[]),
                patch("archero_guild.ocr.service.detect_member_rows", return_value=[]),
                patch("archero_guild.ocr.service.extract_member_metrics_from_screenshots", return_value=[]),
                patch("archero_guild.ocr.service._write_diagnostics"),
            ):
                result = scan_image(path, "guild-members")

        self.assertEqual(result["quality"]["status"], "review")
        self.assertIn("No rows detected", result["quality"]["warnings"][0])


if __name__ == "__main__":
    unittest.main()
