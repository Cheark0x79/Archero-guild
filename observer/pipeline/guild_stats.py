from __future__ import annotations

import re
import argparse
import json
from pathlib import Path
from typing import Any


NUMBER = r"([0-9][0-9.,]*[ \t]*[KMBT]?)"


def extract_guild_stats_from_screenshot(image_path: Path) -> dict[str, Any]:
    """Extract the fixed guild overview header from a Guild Members screenshot."""
    from PIL import Image, ImageEnhance, ImageOps
    import pytesseract

    with Image.open(image_path) as source:
        # The overview is fixed in the top-right of every supported portrait capture.
        # Ratios keep the crop stable for both 1080p captures and 2x device exports.
        width, height = source.size
        header = source.crop((round(width * .35), 0, width, round(height * .20)))
        grayscale = ImageOps.grayscale(header)
        prepared = ImageEnhance.Contrast(grayscale).enhance(2.2)
        text = pytesseract.image_to_string(prepared, lang="eng", config="--psm 6")
        tier_crop = source.crop((
            round(width * .73), round(height * .127),
            round(width * .998), round(height * .17),
        ))
        tier_prepared = ImageEnhance.Contrast(ImageOps.grayscale(tier_crop)).enhance(2.2)
        tier_prepared = tier_prepared.resize((tier_prepared.width * 2, tier_prepared.height * 2))
        tier_text = pytesseract.image_to_string(tier_prepared, lang="eng", config="--psm 7").strip()
    result = parse_guild_stats_text(text)
    tier_name, tier_rank = _expedition_value(_remove_badge_ocr(tier_text))
    if tier_name and tier_rank:
        result["expeditionName"] = tier_name
        result["expeditionRank"] = tier_rank
    required = (
        "guildName", "guildId", "level", "memberCount", "memberCapacity",
        "totalPower", "expeditionPoints", "expeditionName", "expeditionRank",
        "xpCurrent", "xpRequired",
    )
    result["quality"] = {
        "status": "review" if any(result.get(field) is None for field in required) else "pass",
        "missingFields": [field for field in required if result.get(field) is None],
    }
    return result


def parse_guild_stats_text(text: str) -> dict[str, Any]:
    """Parse label/value OCR text without assuming screenshot coordinates."""
    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    members = _match(normalized, r"(?:members?|membres?)?\s*[.·:]?\s*(\d{1,3})\s*/\s*(\d{1,3})", groups=2)
    experience = _match(normalized, rf"(?:xp|experience|expérience)\s*[:#-]?\s*{NUMBER}\s*/\s*{NUMBER}", groups=2)
    if experience is None:
        candidates = re.findall(r"([0-9][0-9.,]*[KMBT]?)\s*/\s*([0-9][0-9.,]*[KMBT]?)", normalized, re.IGNORECASE)
        experience = next(
            (pair for pair in reversed(candidates) if _parse_compact(pair[1]) >= 1_000),
            None,
        )
    total_power = _compact_value(normalized, rf"(?:total power|puissance totale)\s*[:#-]?\s*{NUMBER}")
    if total_power is None:
        total_power = _compact_value(normalized, r"(?:^|\s)([0-9]+[.,][0-9]+\s*[KMBT])(?:\s|$)")
    expedition_points = _compact_value(
        normalized,
        rf"(?:expedition points?|points? d['’ ]expédition)\s*[:#-]?\s*{NUMBER}",
    )
    if expedition_points is None:
        power_then_points = _match(
            normalized,
            r"[0-9]+[.,][0-9]+\s*[KMBT]\D{0,12}(\d{1,9})(?:\D|$)",
        )
        expedition_points = int(power_then_points[0]) if power_then_points else None
    expedition_name, expedition_rank = _expedition_value(normalized)
    return {
        "guildName": _text_value(normalized, r"(?:guild name|nom de (?:la )?guilde|^name)\s*[:#-]?\s*([^\n]+)"),
        "guildId": _text_value(normalized, r"(?:guild id|id (?:de (?:la )?)?guilde|(?:^|\n)id)\s*[:#-]?\s*([A-Za-z0-9_-]+)"),
        "level": _integer_value(normalized, r"(?:guild level|niveau(?: de (?:la )?guilde)?|lv\.?)\s*[:#-]?\s*(\d+)"),
        "memberCount": int(members[0]) if members else None,
        "memberCapacity": int(members[1]) if members else None,
        "totalPower": total_power,
        "expeditionPoints": expedition_points,
        "expeditionName": expedition_name,
        "expeditionRank": expedition_rank,
        # Kept in schema version 1 for backward compatibility only.
        "donationsValue": _compact_value(normalized, rf"(?:donations?|dons?)\s*[:#-]?\s*{NUMBER}"),
        "rank": _integer_value(normalized, r"(?:guild rank|classement(?: de (?:la )?guilde)?)\s*[:#-]?\s*#?\s*(\d+)"),
        "xpCurrent": _parse_compact(experience[0]) if experience else None,
        "xpRequired": _parse_compact(experience[1]) if experience else None,
        "rawText": normalized,
    }


def _expedition_value(text: str) -> tuple[str | None, str | None]:
    labeled = _match(
        text,
        r"(?:expedition|expédition)(?: name| tier)?\s*[:#-]?\s*([A-Za-z][A-Za-z '\-]+?)\s+([IVX|!]{1,5})(?:\s|$)",
        groups=2,
    )
    if labeled is None:
        labeled = _match(text, r"(?:^|\s)([A-Za-z][A-Za-z '\-]{2,}?)\s+([IVX|!]{1,5})(?:\s|$)", groups=2)
    if labeled is None:
        return None, None
    name = re.sub(r"^(?:Recruit\s+|[A-Za-z]\s*>\s*)", "", labeled[0], flags=re.IGNORECASE).strip()
    rank = labeled[1].replace("|", "I").replace("!", "I")
    return (name or None), (rank or None)


def _remove_badge_ocr(text: str) -> str:
    """Discard the small expedition badge glyph that Tesseract reads as a short word."""
    cleaned = re.sub(r"^[^A-Za-z]+", "", text.strip())
    return re.sub(r"^[A-Za-z]{1,2}\s+(?=[A-Z])", "", cleaned)


def _match(text: str, pattern: str, *, groups: int = 1) -> tuple[str, ...] | None:
    match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
    return tuple(match.group(index) for index in range(1, groups + 1)) if match else None


def _text_value(text: str, pattern: str) -> str | None:
    value = _match(text, pattern)
    return value[0].strip() if value else None


def _integer_value(text: str, pattern: str) -> int | None:
    value = _match(text, pattern)
    return int(value[0]) if value else None


def _compact_value(text: str, pattern: str) -> int | None:
    value = _match(text, pattern)
    return _parse_compact(value[0]) if value else None


def _parse_compact(value: str) -> int:
    cleaned = value.replace(" ", "").replace(",", ".").upper()
    multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000, "T": 1_000_000_000_000}
    suffix = cleaned[-1] if cleaned[-1] in multiplier else ""
    number = float(cleaned[:-1] if suffix else cleaned)
    return round(number * multiplier.get(suffix, 1))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract guild overview statistics from one private screenshot.")
    parser.add_argument("image", type=Path)
    args = parser.parse_args(argv)
    print(json.dumps(extract_guild_stats_from_screenshot(args.image), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
