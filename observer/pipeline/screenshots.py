from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


class ScreenshotNormalizationError(RuntimeError):
    pass


class ScreenshotDependencyError(RuntimeError):
    pass


@dataclass(frozen=True)
class CropRegion:
    x: int
    y: int
    width: int
    height: int

    @property
    def box(self) -> tuple[int, int, int, int]:
        return (self.x, self.y, self.x + self.width, self.y + self.height)


@dataclass(frozen=True)
class ScreenshotNormalizationProfile:
    target_width: int
    target_height: int
    crop: CropRegion | None = None
    grayscale: bool = False
    autocontrast: bool = False
    threshold: int | None = None

    def __post_init__(self) -> None:
        if self.target_width <= 0 or self.target_height <= 0:
            raise ValueError("target dimensions must be positive")
        if self.threshold is not None and not 0 <= self.threshold <= 255:
            raise ValueError("threshold must be between 0 and 255")


@dataclass(frozen=True)
class NormalizedScreenshot:
    path: Path
    width: int
    height: int
    mode: str
    sha256: str


DEFAULT_SCREEN_PROFILE = ScreenshotNormalizationProfile(
    target_width=1080,
    target_height=2400,
)

OCR_NUMERIC_PROFILE = ScreenshotNormalizationProfile(
    target_width=900,
    target_height=180,
    grayscale=True,
    autocontrast=True,
    threshold=170,
)


def normalize_screenshot(
    input_path: Path,
    output_path: Path,
    profile: ScreenshotNormalizationProfile = DEFAULT_SCREEN_PROFILE,
) -> NormalizedScreenshot:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise ScreenshotDependencyError(
            "Pillow is required to normalize screenshots. Use the Nix dev shell."
        ) from exc

    if not input_path.exists():
        raise FileNotFoundError(input_path)

    with Image.open(input_path) as image:
        normalized = normalize_image(image, profile)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        normalized.save(output_path, format="PNG", optimize=False, compress_level=6)

    payload = output_path.read_bytes()
    return NormalizedScreenshot(
        path=output_path,
        width=normalized.width,
        height=normalized.height,
        mode=normalized.mode,
        sha256=hashlib.sha256(payload).hexdigest(),
    )


def normalize_image(image: object, profile: ScreenshotNormalizationProfile = DEFAULT_SCREEN_PROFILE) -> object:
    try:
        from PIL import Image, ImageOps  # type: ignore[import-not-found]
    except ImportError as exc:
        raise ScreenshotDependencyError(
            "Pillow is required to normalize screenshots. Use the Nix dev shell."
        ) from exc

    if not isinstance(image, Image.Image):
        raise TypeError("image must be a PIL Image")

    working = ImageOps.exif_transpose(image)

    if profile.crop is not None:
        _validate_crop(working.width, working.height, profile.crop)
        working = working.crop(profile.crop.box)

    if profile.grayscale or profile.threshold is not None:
        working = ImageOps.grayscale(working)
    else:
        working = working.convert("RGB")

    if working.size != (profile.target_width, profile.target_height):
        working = working.resize(
            (profile.target_width, profile.target_height),
            Image.Resampling.LANCZOS,
        )

    if profile.autocontrast:
        working = ImageOps.autocontrast(working)

    if profile.threshold is not None:
        threshold = profile.threshold
        working = working.point(lambda pixel: 255 if pixel > threshold else 0, mode="1").convert("L")

    return working


def _validate_crop(image_width: int, image_height: int, crop: CropRegion) -> None:
    if crop.x < 0 or crop.y < 0 or crop.width <= 0 or crop.height <= 0:
        raise ScreenshotNormalizationError("crop region must use non-negative origin and positive dimensions")
    if crop.x + crop.width > image_width or crop.y + crop.height > image_height:
        raise ScreenshotNormalizationError("crop region exceeds image bounds")


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Normalize an Archero screenshot into a deterministic PNG.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--profile", choices=["screen", "ocr-numeric"], default="screen")
    parser.add_argument("--target", help="Target size as WIDTHxHEIGHT, for example 1080x2400.")
    parser.add_argument("--crop", help="Crop as X,Y,WIDTH,HEIGHT before resizing.")
    parser.add_argument("--grayscale", action="store_true")
    parser.add_argument("--autocontrast", action="store_true")
    parser.add_argument("--threshold", type=int)
    args = parser.parse_args(argv)

    try:
        base_profile = OCR_NUMERIC_PROFILE if args.profile == "ocr-numeric" else DEFAULT_SCREEN_PROFILE
        target_width, target_height = _parse_size(args.target) if args.target else (
            base_profile.target_width,
            base_profile.target_height,
        )
        crop = _parse_crop(args.crop) if args.crop else base_profile.crop

        profile = ScreenshotNormalizationProfile(
            target_width=target_width,
            target_height=target_height,
            crop=crop,
            grayscale=args.grayscale or base_profile.grayscale,
            autocontrast=args.autocontrast or base_profile.autocontrast,
            threshold=args.threshold if args.threshold is not None else base_profile.threshold,
        )
        result = normalize_screenshot(args.input, args.output, profile)
    except (FileNotFoundError, ScreenshotDependencyError, ScreenshotNormalizationError, ValueError) as exc:
        parser.exit(1, f"error: {exc}\n")

    print(
        json.dumps(
            {
                "path": str(result.path),
                "width": result.width,
                "height": result.height,
                "mode": result.mode,
                "sha256": result.sha256,
            },
            indent=2,
        )
    )
    return 0


def _parse_size(value: str) -> tuple[int, int]:
    parts = value.lower().split("x", maxsplit=1)
    if len(parts) != 2:
        raise ValueError("target must use WIDTHxHEIGHT format")
    width, height = (int(part) for part in parts)
    if width <= 0 or height <= 0:
        raise ValueError("target dimensions must be positive")
    return width, height


def _parse_crop(value: str) -> CropRegion:
    parts = [int(part.strip()) for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError("crop must use X,Y,WIDTH,HEIGHT format")
    return CropRegion(x=parts[0], y=parts[1], width=parts[2], height=parts[3])


if __name__ == "__main__":
    raise SystemExit(main())
