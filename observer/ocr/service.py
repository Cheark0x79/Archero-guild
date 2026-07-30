from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from observer.import_capture import read_roster_entries
from observer.pipeline.guild_boss import boss_podium_regions, detect_boss_ranking_rows, extract_boss_rankings_from_screenshots
from observer.pipeline.guild_member_ocr import extract_member_metrics_from_screenshots
from observer.pipeline.guild_members import detect_member_rows
from observer.pipeline.image_geometry import image_geometry_for_path, normalize_analysis_image


def scan_image(
    image_path: Path,
    kind: str,
    *,
    include_podium: bool = True,
    roster: list[Any] | None = None,
    normalized_path: Path | None = None,
    annotated_path: Path | None = None,
) -> dict[str, Any]:
    if kind not in {"guild-members", "guild-boss"}:
        raise ValueError(f"unsupported OCR kind: {kind}")

    started = time.perf_counter()
    roster = roster if roster is not None else _load_roster()
    geometry = image_geometry_for_path(image_path)
    rows = detect_member_rows(image_path) if kind == "guild-members" else detect_boss_ranking_rows(image_path)
    podium_regions = (
        boss_podium_regions(
            geometry.analysis_width,
            geometry.analysis_height,
            list_top=rows[0].bounds.y if rows else None,
        )
        if kind == "guild-boss" and include_podium
        else []
    )
    detection_finished = time.perf_counter()

    if kind == "guild-members":
        extracted = extract_member_metrics_from_screenshots([image_path], roster)
        data_rows = [
            {
                "playerId": item.player_id or None,
                "name": item.name or None,
                "role": item.role,
                "power": item.power,
                "powerText": item.power_text,
                "contribution7d": item.donation,
                "bossAttacks": item.boss_tries,
                "lastActivityDays": item.last_activity_days,
                "activityText": item.activity_text,
                "roleText": item.role_text,
                "rawActivity": item.raw_activity,
                "rawRole": item.raw_role,
                "source": item.source,
                "matchScore": round(item.match_score, 3),
                "matchType": _match_type(item.match_score),
                "matchStatus": "matched" if item.player_id else "unmatched",
                "rawName": item.raw_name,
            }
            for item in extracted
        ]
    else:
        extracted = extract_boss_rankings_from_screenshots(
            [image_path],
            roster,
            include_podium=include_podium,
        )
        data_rows = [
            {
                "playerId": item.player_id,
                "name": item.name,
                "rawName": item.raw_name,
                "rank": item.boss_rank,
                "damageText": item.damage_text,
                "damage": item.boss_damage_today,
                "area": item.area,
                "rowIndex": item.row_index,
                "source": item.source,
            }
            for item in extracted
        ]
    ocr_finished = time.perf_counter()

    _write_diagnostics(
        image_path,
        rows,
        podium_regions=podium_regions,
        normalized_path=normalized_path,
        annotated_path=annotated_path,
    )
    useful_rows = [row for row in data_rows if _row_has_useful_data(row, kind)]
    required_fields = (
        ("name", "powerText", "roleText", "activityText", "contribution7d", "bossAttacks")
        if kind == "guild-members"
        else ("rank", "damageText")
    )
    complete_rows = [row for row in useful_rows if all(row.get(field) is not None for field in required_fields)]
    expected = len(rows) + (3 if kind == "guild-boss" and include_podium else 0)
    coverage = len(useful_rows) / expected if expected else 0.0
    completeness = len(complete_rows) / expected if expected else 0.0

    warnings: list[str] = []
    if expected == 0:
        warnings.append("No rows detected. Check the selected capture type and screenshot framing.")
    if coverage < 1:
        warnings.append(f"OCR returned useful data for {len(useful_rows)} of {expected} detected positions.")
    if completeness < 1:
        warnings.append(f"Only {len(complete_rows)} of {expected} rows contain every required field.")

    return {
        "schemaVersion": 1,
        "kind": kind,
        "options": {"includePodium": include_podium} if kind == "guild-boss" else {},
        "input": {
            "width": geometry.source_width,
            "height": geometry.source_height,
        },
        "normalization": {
            "canonicalWidth": geometry.analysis_width,
            "canonicalHeight": geometry.analysis_height,
            "scale": round(geometry.scale, 6),
        },
        "detection": {
            "rowCount": len(rows),
            "podiumCount": len(podium_regions),
            "rows": [
                {
                    "index": row.index,
                    "bounds": asdict(row.bounds),
                    "fields": {name: asdict(value) for name, value in vars(row.fields).items()},
                }
                for row in rows
            ],
        },
        "rows": data_rows,
        "quality": {
            "status": "pass" if expected > 0 and coverage == 1 and completeness == 1 else "review",
            "expectedRows": expected,
            "usefulRows": len(useful_rows),
            "completeRows": len(complete_rows),
            "coverage": round(coverage, 4),
            "completeness": round(completeness, 4),
            "warnings": warnings,
        },
        "timingsMs": {
            "detection": round((detection_finished - started) * 1000),
            "ocr": round((ocr_finished - detection_finished) * 1000),
            "total": round((time.perf_counter() - started) * 1000),
        },
    }


def _load_roster(roster_path: Path | None = None) -> list[Any]:
    if roster_path is not None:
        from observer.pipeline.guild_member_ocr import RosterEntry

        payload = json.loads(roster_path.read_text(encoding="utf-8"))
        rows = payload.get("data", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise ValueError("roster JSON must be an array or an API response containing data")
        return [
            RosterEntry(
                player_id=str(row.get("playerId") or row.get("player_id") or ""),
                name=str(row.get("name") or ""),
                power_hint=(row.get("metrics") or {}).get("power", row.get("power")),
            )
            for row in rows
            if isinstance(row, dict) and row.get("name")
        ]
    sample_data = Path("web/sample-data.js")
    return read_roster_entries(sample_data) if sample_data.exists() else []


def _write_diagnostics(
    image_path: Path,
    rows: list[Any],
    *,
    podium_regions: list[Any] | None = None,
    normalized_path: Path | None,
    annotated_path: Path | None,
) -> None:
    from PIL import Image, ImageDraw

    with Image.open(image_path) as source:
        normalized = normalize_analysis_image(source)
    if normalized_path:
        normalized.save(normalized_path, format="PNG", optimize=True)
    if annotated_path:
        annotated = normalized.copy()
        draw = ImageDraw.Draw(annotated)
        for region in podium_regions or []:
            name_field = region.name_candidates[0]
            draw.text((name_field.x, max(0, name_field.y - 18)), f"podium {region.rank}", fill=(0, 20, 30))
            for field, color in (
                (name_field, (80, 220, 120)),
                (region.damage, (255, 200, 60)),
            ):
                draw.rectangle(
                    (field.x, field.y, field.right, field.bottom),
                    outline=color,
                    width=3,
                )
        for row in rows:
            bounds = row.bounds
            draw.rectangle(
                (bounds.x, bounds.y, bounds.right, bounds.bottom),
                outline=(0, 210, 255),
                width=4,
            )
            draw.text((bounds.x + 8, bounds.y + 6), f"row {row.index + 1}", fill=(0, 20, 30))
            for field_name, field in vars(row.fields).items():
                color = {
                    "name": (80, 220, 120),
                    "power_value": (255, 200, 60),
                    "damage": (255, 200, 60),
                    "role": (190, 120, 255),
                    "boss_tries_value": (255, 130, 80),
                    "donation_value": (255, 130, 80),
                    "status": (100, 170, 255),
                    "rank": (100, 170, 255),
                }.get(field_name)
                if color is None:
                    continue
                display_field = _visible_content_rect(annotated, field, field_name) or field
                draw.rectangle(
                    (
                        display_field.x,
                        display_field.y,
                        display_field.right,
                        display_field.bottom,
                    ),
                    outline=color,
                    width=2,
                )
        annotated.save(annotated_path, format="PNG", optimize=True)


def _visible_content_rect(image: Any, field: Any, field_name: str) -> Any | None:
    if field_name == "role":
        return field
    foreground_by_x: dict[int, list[int]] = {}
    for y in range(field.y, field.bottom):
        for x in range(field.x, field.right):
            red, green, blue = image.getpixel((x, y))
            if field_name == "status":
                is_foreground = green > 130 and green > red + 25 and green > blue + 20
            else:
                is_foreground = red < 155 and green < 155 and blue < 155
            if is_foreground:
                foreground_by_x.setdefault(x, []).append(y)
    candidate_xs = sorted(x for x, ys in foreground_by_x.items() if len(ys) >= 2)
    runs: list[tuple[int, int]] = []
    for x in candidate_xs:
        if not runs or x - runs[-1][1] > 8:
            runs.append((x, x))
        else:
            runs[-1] = (runs[-1][0], x)
    substantial_runs = [run for run in runs if run[1] - run[0] >= 9]
    if not substantial_runs:
        return None
    selected_xs = [
        x
        for start, end in substantial_runs
        for x in candidate_xs
        if start <= x <= end
    ]
    ys = [y for x in selected_xs for y in foreground_by_x[x]]
    rect_type = type(field)
    padding = 3
    left = max(field.x, min(selected_xs) - padding)
    top = max(field.y, min(ys) - padding)
    right = min(field.right, max(selected_xs) + padding + 1)
    bottom = min(field.bottom, max(ys) + padding + 1)
    return rect_type(left, top, max(1, right - left), max(1, bottom - top))


def _row_has_useful_data(row: dict[str, Any], kind: str) -> bool:
    fields = ("name", "power", "contribution7d", "bossAttacks") if kind == "guild-members" else ("name", "rank", "damageText")
    return any(row.get(field) is not None for field in fields)


def _match_type(score: float) -> str:
    if score >= 0.999:
        return "exact"
    if score >= 0.98:
        return "name-contained"
    if score >= 0.70:
        return "fuzzy"
    return "unmatched"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the side-effect-free Archero OCR service.")
    parser.add_argument("kind", choices=("guild-members", "guild-boss"))
    parser.add_argument("image", type=Path)
    parser.add_argument("--normalized", type=Path)
    parser.add_argument("--annotated", type=Path)
    parser.add_argument("--roster", type=Path)
    parser.add_argument("--no-podium", action="store_true")
    args = parser.parse_args(argv)
    print(
        json.dumps(
            scan_image(
                args.image,
                args.kind,
                include_podium=not args.no_podium,
                roster=_load_roster(args.roster) if args.roster else None,
                normalized_path=args.normalized,
                annotated_path=args.annotated,
            ),
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
