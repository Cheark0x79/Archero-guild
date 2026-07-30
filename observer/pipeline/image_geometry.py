from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


CANONICAL_ANALYSIS_WIDTH = 1080


@dataclass(frozen=True)
class ImageGeometry:
    source_width: int
    source_height: int
    analysis_width: int
    analysis_height: int
    scale: float


def image_geometry(image: object) -> ImageGeometry:
    source_width = int(image.width)
    source_height = int(image.height)
    if source_width <= 0 or source_height <= 0:
        raise ValueError("screenshot dimensions must be positive")

    scale = CANONICAL_ANALYSIS_WIDTH / source_width
    return ImageGeometry(
        source_width=source_width,
        source_height=source_height,
        analysis_width=CANONICAL_ANALYSIS_WIDTH,
        analysis_height=max(1, round(source_height * scale)),
        scale=scale,
    )


def normalize_analysis_image(image: object) -> object:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("Pillow is required to normalize screenshots.") from exc

    if not isinstance(image, Image.Image):
        raise TypeError("image must be a PIL image")

    geometry = image_geometry(image)
    rgb = image.convert("RGB")
    if rgb.size == (geometry.analysis_width, geometry.analysis_height):
        return rgb
    return rgb.resize(
        (geometry.analysis_width, geometry.analysis_height),
        Image.Resampling.LANCZOS,
    )


def image_geometry_for_path(path: Path) -> ImageGeometry:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("Pillow is required to inspect screenshots.") from exc

    with Image.open(path) as image:
        return image_geometry(image)
