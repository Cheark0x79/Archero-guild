from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence

from observer.pipeline.image_geometry import normalize_analysis_image


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
        rgb = normalize_analysis_image(image)
        intervals = _detect_row_intervals(rgb)
        bounds = [_detect_row_bounds(rgb, y1, y2) for y1, y2 in intervals]
        return [MemberRow(index=index, bounds=rect, fields=_infer_fields(rect, rgb)) for index, rect in enumerate(bounds)]


def export_member_row_crops(screenshot_path: Path, output_dir: Path) -> list[Path]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberDetectionError("Pillow is required to export guild member crops.") from exc

    rows = detect_member_rows(screenshot_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    with Image.open(screenshot_path) as source_image:
        image = normalize_analysis_image(source_image)
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
    scale = width / 1080
    x_start = max(0, int(width * 0.045))
    x_end = min(width, int(width * 0.95))
    y_start = int(height * 0.30)
    y_end = int(height * 0.86)
    minimum_matches = round(70 * scale)
    maximum_gap = max(1, round(8 * scale))
    minimum_row_height = round(100 * scale)
    maximum_row_height = round(180 * scale)

    row_like_y: list[int] = []
    for y in range(y_start, y_end):
        matches = 0
        for x in range(x_start, x_end, 4):
            if _is_member_card_pixel(image.getpixel((x, y))):
                matches += 1
        if matches > minimum_matches:
            row_like_y.append(y)

    intervals = _merge_nearby_values(row_like_y, max_gap=maximum_gap)
    return [
        (start, end)
        for start, end in intervals
        if minimum_row_height <= end - start + 1 <= maximum_row_height
    ]


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


def _infer_fields(row: Rect, image: object | None = None) -> MemberRowFields:
    role = _detect_role_badge(image, row) if image is not None else None
    role = role or _relative_rect(row, 0.20, 0.16, 0.27, 0.38)
    name_start = min(row.x + round(row.width * 0.70), role.right + round(row.width * 0.012))
    name_right = row.x + round(row.width * 0.82)
    return MemberRowFields(
        avatar=_relative_rect(row, 0.02, 0.07, 0.14, 0.86),
        role=role,
        name=Rect(
            x=name_start,
            y=row.y + round(row.height * 0.14),
            width=max(1, name_right - name_start),
            height=round(row.height * 0.38),
        ),
        power=_relative_rect(row, 0.19, 0.62, 0.21, 0.28),
        power_value=_relative_rect(row, 0.275, 0.55, 0.16, 0.37),
        boss_tries=_relative_rect(row, 0.43, 0.61, 0.25, 0.29),
        boss_tries_value=_relative_rect(row, 0.49, 0.56, 0.15, 0.38),
        donation=_relative_rect(row, 0.68, 0.60, 0.29, 0.30),
        donation_value=_relative_rect(row, 0.72, 0.56, 0.18, 0.38),
        status=_relative_rect(row, 0.84, 0.04, 0.14, 0.34),
    )


def _detect_role_badge(image: object, row: Rect) -> Rect | None:
    search = _relative_rect(row, 0.18, 0.08, 0.34, 0.48)
    pixels_by_x: dict[int, list[int]] = {}
    for y in range(search.y, search.bottom, 2):
        for x in range(search.x, search.right, 2):
            red, green, blue = image.getpixel((x, y))
            is_blue_badge = blue > red + 35 and green > red + 25
            is_brown_badge = red < 230 and red > green + 25 and green > blue + 18
            if is_blue_badge or is_brown_badge:
                pixels_by_x.setdefault(x, []).append(y)
    badge_columns = sorted(x for x, ys in pixels_by_x.items() if len(ys) >= 4)
    runs = _merge_nearby_values(badge_columns, max_gap=4)
    if not runs:
        return None
    run_start, run_end = max(runs, key=lambda run: run[1] - run[0])
    xs = [x for x in badge_columns if run_start <= x <= run_end]
    ys = [y for x in xs for y in pixels_by_x[x]]
    if len(ys) < 40:
        return None
    padding_x = max(2, round(row.width * 0.006))
    left = max(row.x, min(xs) - padding_x)
    top = row.y + round(row.height * 0.12)
    right = min(row.right, max(xs) + padding_x + 2)
    bottom = min(row.bottom, top + round(row.height * 0.34))
    return Rect(left, top, max(1, right - left), max(1, bottom - top))


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
