from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence


class GuildMemberDetectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height


@dataclass(frozen=True)
class MemberRowFields:
    avatar: Rect
    role: Rect
    name: Rect
    power: Rect
    power_value: Rect
    boss_tries: Rect
    boss_tries_value: Rect
    donation: Rect
    donation_value: Rect
    status: Rect


@dataclass(frozen=True)
class MemberRow:
    index: int
    bounds: Rect
    fields: MemberRowFields


def detect_member_rows(path: Path) -> list[MemberRow]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberDetectionError("Pillow is required to detect guild member rows.") from exc

    if not path.exists():
        raise FileNotFoundError(path)

    with Image.open(path) as image:
        rgb = image.convert("RGB")
        intervals = _detect_row_intervals(rgb)
        bounds = [_detect_row_bounds(rgb, y1, y2) for y1, y2 in intervals]
        return [MemberRow(index=index, bounds=rect, fields=_infer_fields(rect)) for index, rect in enumerate(bounds)]


def export_member_row_crops(screenshot_path: Path, output_dir: Path) -> list[Path]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberDetectionError("Pillow is required to export guild member crops.") from exc

    rows = detect_member_rows(screenshot_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    with Image.open(screenshot_path) as image:
        for row in rows:
            row_path = output_dir / f"row-{row.index:02d}.png"
            image.crop(_box(row.bounds)).save(row_path, format="PNG")
            written.append(row_path)

            for field_name, field in asdict(row.fields).items():
                rect = Rect(**field)
                field_path = output_dir / f"row-{row.index:02d}-{field_name}.png"
                image.crop(_box(rect)).save(field_path, format="PNG")
                written.append(field_path)

    return written


def _detect_row_intervals(image: object) -> list[tuple[int, int]]:
    height = image.height
    width = image.width
    x_start = max(0, int(width * 0.045))
    x_end = min(width, int(width * 0.95))
    y_start = int(height * 0.30)
    y_end = int(height * 0.86)

    row_like_y: list[int] = []
    for y in range(y_start, y_end):
        matches = 0
        for x in range(x_start, x_end, 4):
            if _is_member_card_pixel(image.getpixel((x, y))):
                matches += 1
        if matches > 70:
            row_like_y.append(y)

    intervals = _merge_nearby_values(row_like_y, max_gap=8)
    return [(start, end) for start, end in intervals if 100 <= end - start + 1 <= 180]


def _detect_row_bounds(image: object, y1: int, y2: int) -> Rect:
    xs: list[int] = []
    for x in range(image.width):
        matches = 0
        for y in range(y1 + 10, y2 - 10, 8):
            if _is_member_card_pixel(image.getpixel((x, y))):
                matches += 1
        if matches >= 5:
            xs.append(x)

    if not xs:
        raise GuildMemberDetectionError(f"Could not detect row bounds for y={y1}..{y2}")

    return Rect(x=min(xs), y=y1, width=max(xs) - min(xs) + 1, height=y2 - y1 + 1)


def _infer_fields(row: Rect) -> MemberRowFields:
    return MemberRowFields(
        avatar=_relative_rect(row, 0.02, 0.07, 0.14, 0.86),
        role=_relative_rect(row, 0.20, 0.20, 0.25, 0.33),
        name=_relative_rect(row, 0.38, 0.16, 0.36, 0.34),
        power=_relative_rect(row, 0.19, 0.62, 0.21, 0.28),
        power_value=_relative_rect(row, 0.265, 0.62, 0.16, 0.28),
        boss_tries=_relative_rect(row, 0.43, 0.61, 0.25, 0.29),
        boss_tries_value=_relative_rect(row, 0.49, 0.61, 0.15, 0.29),
        donation=_relative_rect(row, 0.68, 0.60, 0.29, 0.30),
        donation_value=_relative_rect(row, 0.715, 0.60, 0.22, 0.30),
        status=_relative_rect(row, 0.84, 0.09, 0.14, 0.30),
    )


def _relative_rect(row: Rect, x: float, y: float, width: float, height: float) -> Rect:
    return Rect(
        x=row.x + round(row.width * x),
        y=row.y + round(row.height * y),
        width=round(row.width * width),
        height=round(row.height * height),
    )


def _box(rect: Rect) -> tuple[int, int, int, int]:
    return (rect.x, rect.y, rect.right, rect.bottom)


def _merge_nearby_values(values: Sequence[int], *, max_gap: int) -> list[tuple[int, int]]:
    if not values:
        return []

    intervals: list[tuple[int, int]] = []
    start = previous = values[0]
    for value in values[1:]:
        if value <= previous + max_gap:
            previous = value
            continue
        intervals.append((start, previous))
        start = previous = value

    intervals.append((start, previous))
    return intervals


def _is_member_card_pixel(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    return red > 210 and green > 170 and blue > 110 and red > green and green > blue and red - blue > 45


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Detect guild member rows in a full Archero guild screenshot.")
    parser.add_argument("screenshot", type=Path)
    parser.add_argument("--crops-dir", type=Path, help="Optional directory where detected row and field crops are written.")
    args = parser.parse_args(argv)

    rows = detect_member_rows(args.screenshot)
    crops = export_member_row_crops(args.screenshot, args.crops_dir) if args.crops_dir else []
    print(
        json.dumps(
            {
                "rows": [_row_to_dict(row) for row in rows],
                "crops": [str(path) for path in crops],
            },
            indent=2,
        )
    )
    return 0


def _row_to_dict(row: MemberRow) -> dict[str, object]:
    return {
        "index": row.index,
        "bounds": asdict(row.bounds),
        "fields": asdict(row.fields),
    }


if __name__ == "__main__":
    raise SystemExit(main())
