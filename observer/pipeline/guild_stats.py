from __future__ import annotations

import re
import argparse
import json
from pathlib import Path
from typing import Any


NUMBER = r"([0-9][0-9.,]*\s*[KMBT]?)"


def extract_guild_stats_from_screenshot(image_path: Path) -> dict[str, Any]:
    """Run a conservative full-screen OCR pass before screenshot-specific calibration."""
    from PIL import Image, ImageEnhance, ImageOps
    import pytesseract

    with Image.open(image_path) as source:
        grayscale = ImageOps.grayscale(source)
        prepared = ImageEnhance.Contrast(grayscale).enhance(1.8)
        text = pytesseract.image_to_string(prepared, lang="eng", config="--psm 6")
    result = parse_guild_stats_text(text)
    required = ("guildName", "level", "memberCount", "memberCapacity")
    result["quality"] = {
        "status": "review" if any(result.get(field) is None for field in required) else "pass",
        "missingFields": [field for field in required if result.get(field) is None],
    }
    return result


def parse_guild_stats_text(text: str) -> dict[str, Any]:
    """Parse label/value OCR text without assuming screenshot coordinates."""
    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    members = _match(normalized, r"(?:members?|membres?)\s*[:#-]?\s*(\d+)\s*/\s*(\d+)", groups=2)
    experience = _match(normalized, rf"(?:xp|experience|expérience)\s*[:#-]?\s*{NUMBER}\s*/\s*{NUMBER}", groups=2)
    return {
        "guildName": _text_value(normalized, r"(?:guild name|nom de (?:la )?guilde)\s*[:#-]\s*([^\n]+)"),
        "guildId": _text_value(normalized, r"(?:guild id|id (?:de (?:la )?)?guilde)\s*[:#-]\s*([A-Za-z0-9_-]+)"),
        "level": _integer_value(normalized, r"(?:guild level|niveau(?: de (?:la )?guilde)?)\s*[:#-]?\s*(\d+)"),
        "memberCount": int(members[0]) if members else None,
        "memberCapacity": int(members[1]) if members else None,
        "totalPower": _compact_value(normalized, rf"(?:total power|puissance totale)\s*[:#-]?\s*{NUMBER}"),
        "donationsValue": _compact_value(normalized, rf"(?:donations?|dons?)\s*[:#-]?\s*{NUMBER}"),
        "rank": _integer_value(normalized, r"(?:guild rank|classement(?: de (?:la )?guilde)?)\s*[:#-]?\s*#?\s*(\d+)"),
        "xpCurrent": _parse_compact(experience[0]) if experience else None,
        "xpRequired": _parse_compact(experience[1]) if experience else None,
        "rawText": normalized,
    }


def _match(text: str, pattern: str, *, groups: int = 1) -> tuple[str, ...] | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
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
