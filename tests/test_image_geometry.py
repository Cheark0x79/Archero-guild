import tempfile
import unittest
from pathlib import Path

from observer.pipeline.guild_boss import detect_boss_ranking_rows
from observer.pipeline.guild_members import detect_member_rows
from observer.pipeline.image_geometry import image_geometry, normalize_analysis_image

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    Image = None
    ImageDraw = None


@unittest.skipIf(Image is None, "Pillow is required for screenshot geometry tests")
class ScreenshotGeometryTests(unittest.TestCase):
    def test_normalizes_source_sizes_to_one_analysis_width(self) -> None:
        source = Image.new("RGB", (1440, 2560))

        geometry = image_geometry(source)
        normalized = normalize_analysis_image(source)

        self.assertEqual((geometry.analysis_width, geometry.analysis_height), (1080, 1920))
        self.assertEqual(normalized.size, (1080, 1920))

    def test_member_detection_is_stable_across_source_resolutions(self) -> None:
        counts = self._detect_across_sizes("member")

        self.assertEqual(counts, {720: 5, 1080: 5, 1440: 5})

    def test_boss_detection_is_stable_across_source_resolutions(self) -> None:
        counts = self._detect_across_sizes("boss")

        self.assertEqual(counts, {720: 5, 1080: 5, 1440: 5})

    def _detect_across_sizes(self, kind: str) -> dict[int, int]:
        base = Image.new("RGB", (1080, 1920), (8, 8, 12))
        draw = ImageDraw.Draw(base)
        color = (230, 190, 120) if kind == "member" else (100, 40, 60)
        start_y = 620
        for index in range(5):
            y = start_y + index * 180
            draw.rectangle((50, y, 1025, y + 149), fill=color)

        detector = detect_member_rows if kind == "member" else detect_boss_ranking_rows
        counts: dict[int, int] = {}
        with tempfile.TemporaryDirectory() as directory:
            for width in (720, 1080, 1440):
                height = round(base.height * width / base.width)
                path = Path(directory) / f"{kind}-{width}.png"
                base.resize((width, height), Image.Resampling.LANCZOS).save(path)
                counts[width] = len(detector(path))
        return counts


if __name__ == "__main__":
    unittest.main()
