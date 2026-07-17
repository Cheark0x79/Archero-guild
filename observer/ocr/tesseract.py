from __future__ import annotations

from pathlib import Path


class OcrDependencyError(RuntimeError):
    pass


def read_numeric_field(path: Path) -> str:
    try:
        from PIL import Image, ImageOps  # type: ignore[import-not-found]
        import pytesseract  # type: ignore[import-not-found]
    except ImportError as exc:
        raise OcrDependencyError(
            "Pillow and pytesseract are required for OCR. Install them through the Nix dev shell."
        ) from exc

    if not path.exists():
        raise FileNotFoundError(path)

    image = Image.open(path)
    gray = ImageOps.grayscale(image)
    enlarged = gray.resize((gray.width * 3, gray.height * 3))
    thresholded = enlarged.point(lambda pixel: 255 if pixel > 170 else 0)

    text = pytesseract.image_to_string(
        thresholded,
        config="--psm 7 -c tessedit_char_whitelist=0123456789",
    )
    return "".join(character for character in text if character.isdigit())
