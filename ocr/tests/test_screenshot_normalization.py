import tempfile
import unittest
from contextlib import redirect_stdout
from contextlib import redirect_stderr
from io import StringIO
import json
from pathlib import Path

from archero_guild.pipeline.screenshots import (
    CropRegion,
    ScreenshotNormalizationError,
    ScreenshotNormalizationProfile,
    main,
    normalize_image,
    normalize_screenshot,
)

try:
    from PIL import Image
except ImportError:  # pragma: no cover - exercised only outside the OCR runtime
    Image = None


@unittest.skipIf(Image is None, "Pillow is required for screenshot normalization tests")
class ScreenshotNormalizationTests(unittest.TestCase):
    def test_normalizes_to_fixed_dimensions_and_mode(self) -> None:
        image = Image.new("RGB", (400, 800), "white")
        profile = ScreenshotNormalizationProfile(target_width=100, target_height=200)

        normalized = normalize_image(image, profile)

        self.assertEqual(normalized.size, (100, 200))
        self.assertEqual(normalized.mode, "RGB")

    def test_normalization_is_deterministic(self) -> None:
        profile = ScreenshotNormalizationProfile(
            target_width=80,
            target_height=80,
            crop=CropRegion(x=10, y=10, width=60, height=60),
            grayscale=True,
            autocontrast=True,
            threshold=128,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            first = root / "first.png"
            second = root / "second.png"

            image = Image.new("RGB", (100, 100), "white")
            for offset in range(20):
                image.putpixel((20 + offset, 30), (20, 20, 20))
            image.save(source)

            first_result = normalize_screenshot(source, first, profile)
            second_result = normalize_screenshot(source, second, profile)

        self.assertEqual(first_result.sha256, second_result.sha256)
        self.assertEqual(first_result.width, 80)
        self.assertEqual(first_result.height, 80)
        self.assertEqual(first_result.mode, "L")

    def test_rejects_crop_outside_image_bounds(self) -> None:
        image = Image.new("RGB", (100, 100), "white")
        profile = ScreenshotNormalizationProfile(
            target_width=50,
            target_height=50,
            crop=CropRegion(x=80, y=80, width=30, height=30),
        )

        with self.assertRaises(ScreenshotNormalizationError):
            normalize_image(image, profile)

    def test_cli_outputs_json_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            output = root / "normalized.png"
            Image.new("RGB", (40, 80), "white").save(source)

            stdout = StringIO()
            with redirect_stdout(stdout):
                exit_code = main([str(source), str(output), "--target", "20x40"])

            payload = json.loads(stdout.getvalue())

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["width"], 20)
        self.assertEqual(payload["height"], 40)
        self.assertEqual(payload["mode"], "RGB")
        self.assertRegex(payload["sha256"], r"^[a-f0-9]{64}$")

    def test_cli_reports_missing_input_without_traceback(self) -> None:
        stderr = StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as error:
            main(["/tmp/archero-missing-input.png", "/tmp/archero-output.png"])

        self.assertEqual(error.exception.code, 1)
        self.assertIn("error:", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
