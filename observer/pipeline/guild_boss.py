from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, replace
from difflib import SequenceMatcher
from pathlib import Path
from typing import Sequence


class GuildBossDetectionError(RuntimeError):
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
class BossRankingFields:
    rank: Rect
    avatar: Rect
    name: Rect
    damage: Rect


@dataclass(frozen=True)
class BossRankingRow:
    index: int
    bounds: Rect
    fields: BossRankingFields


@dataclass(frozen=True)
class ExtractedBossRanking:
    source: str
    row_index: int
    area: str
    boss_rank: int | None
    player_id: str | None
    name: str | None
    raw_name: str | None
    damage_text: str | None
    boss_damage_today: int | None


_DAMAGE_PATTERN = re.compile(
    r"^\s*(?P<amount>\d+(?:[.,]\d+)?|[.,]\d+)\s*(?P<unit>trillion|trillions|t|billion|billions|b|million|millions|m)\s*$",
    re.IGNORECASE,
)


def parse_boss_damage(value: str) -> int | None:
    match = _DAMAGE_PATTERN.fullmatch(value)
    if match is None:
        return None

    amount_text = match.group("amount").replace(",", ".")
    if amount_text.startswith("."):
        amount_text = f"0{amount_text}"
    amount = float(amount_text)
    unit = match.group("unit").lower()
    multiplier = 1_000_000_000_000 if unit.startswith("t") else 1_000_000_000 if unit.startswith("b") else 1_000_000
    return round(amount * multiplier)


def format_boss_damage(value: int | None, *, fallback_text: str | None = None) -> str:
    if fallback_text and fallback_text.strip():
        return _normalize_boss_damage_text(fallback_text)
    if value is None:
        return "Not recorded"

    unit = "T" if abs(value) >= 1_000_000_000_000 else "B" if abs(value) >= 1_000_000_000 else "M"
    divisor = 1_000_000_000_000 if unit == "T" else 1_000_000_000 if unit == "B" else 1_000_000
    amount = value / divisor
    formatted = f"{amount:.2f}".rstrip("0").rstrip(".")
    return f"{formatted}{unit}"


def _normalize_boss_damage_text(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if normalized.startswith(".") or normalized.startswith(","):
        normalized = f"0{normalized}"
    match = _DAMAGE_PATTERN.fullmatch(normalized)
    if match is not None:
        amount = match.group("amount").replace(",", ".")
        if amount.startswith("."):
            amount = f"0{amount}"
        unit = match.group("unit").upper()[0]
        return f"{amount}{unit}"
    return normalized


def _read_boss_damage_text(image: object, pytesseract: object) -> str | None:
    texts = _ocr_variants(image, pytesseract, whitelist="0123456789.,BbMmTt")
    candidates: list[tuple[int, str]] = []
    for text in texts:
        normalized = _damage_text_from_ocr(text)
        if normalized is None:
            continue
        parsed = parse_boss_damage(normalized)
        if parsed is not None:
            candidates.append((parsed, normalized))

    if not candidates:
        return None

    counts: dict[tuple[int, str], int] = {}
    for candidate in candidates:
        counts[candidate] = counts.get(candidate, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0][0]))[0][0][1]


def _damage_text_from_ocr(value: str) -> str | None:
    normalized = value.replace(",", ".")
    matches = list(re.finditer(r"(\d+(?:\.\d+)?|\.\d+)\s*([BbMmTt])", normalized))
    if not matches:
        unitless = list(re.finditer(r"(\d+\.\d{2})8(?!\d)", normalized))
        if not unitless:
            return None
        return f"{unitless[-1].group(1)}B"
    match = matches[-1]
    unit = match.group(2).upper()[0]
    amount = match.group(1)
    extra_unit_digit = re.fullmatch(r"(\d+\.\d{2})8", amount)
    if extra_unit_digit is not None:
        amount = extra_unit_digit.group(1)
    if amount.startswith("."):
        amount = f"0{amount}"
    return f"{amount}{unit}"


def _read_boss_rank(image: object, pytesseract: object) -> int | None:
    texts = _ocr_variants(image, pytesseract, whitelist="0123456789", psm_values=(10, 7))
    candidates: list[int] = []
    for text in texts:
        match = re.search(r"\d+", text)
        if match:
            value = int(match.group(0))
            if 1 <= value <= 200:
                candidates.append(value)
    if not candidates:
        return None
    counts: dict[int, int] = {}
    for candidate in candidates:
        counts[candidate] = counts.get(candidate, 0) + 1
    return sorted(counts.items(), key=lambda item: (item[1], -item[0]), reverse=True)[0][0]


def _read_podium_name(image: object, pytesseract: object) -> str:
    return _best_text(_ocr_variants(image, pytesseract))


def _ocr_text(image: object, pytesseract: object, *, whitelist: str | None = None) -> str:
    return _best_text(_ocr_variants(image, pytesseract, whitelist=whitelist, languages=("eng", "eng+chi_tra", "eng+chi_sim")))


def _best_text(values: list[str]) -> str:
    cleaned = [" ".join(value.strip().split()) for value in values if value.strip()]
    if not cleaned:
        return ""
    return sorted(cleaned, key=lambda value: (_name_signal_length(value), len(value)), reverse=True)[0]


def _ocr_variants(
    image: object,
    pytesseract: object,
    *,
    whitelist: str | None = None,
    psm_values: tuple[int, ...] = (7,),
    languages: tuple[str, ...] = ("eng",),
    high_threshold: bool = False,
) -> list[str]:
    try:
        from PIL import Image, ImageOps  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildBossDetectionError("Pillow is required to preprocess boss OCR crops.") from exc

    if not isinstance(image, Image.Image):
        raise TypeError("image must be a PIL image")

    gray = ImageOps.grayscale(image)
    base = ImageOps.autocontrast(gray.resize((gray.width * 5, gray.height * 5), Image.Resampling.LANCZOS))
    variants = [
        base,
        ImageOps.invert(base),
        base.point(lambda pixel: 255 if pixel > 80 else 0),
        base.point(lambda pixel: 255 if pixel > 100 else 0),
        base.point(lambda pixel: 255 if pixel > 120 else 0),
        base.point(lambda pixel: 255 if pixel > 160 else 0),
    ]
    if high_threshold:
        variants.append(base.point(lambda pixel: 255 if pixel > 200 else 0))
    texts: list[str] = []
    for prepared in variants:
        for psm in psm_values:
            config = f"--psm {psm}"
            if whitelist is not None:
                config += f" -c tessedit_char_whitelist={whitelist}"
            for language in languages:
                texts.append(pytesseract.image_to_string(prepared, lang=language, config=config).strip())
    return texts


def _match_roster_name(raw_name: str | Sequence[str], roster: Sequence[object]) -> tuple[object, str] | None:
    raw_names = [raw_name] if isinstance(raw_name, str) else list(raw_name)
    best: tuple[object, str, float] | None = None
    for candidate_name in raw_names:
        normalized = _normalize_match_text(candidate_name)
        if not normalized:
            continue
        for entry in roster:
            roster_name = _normalize_match_text(_roster_name(entry))
            if not roster_name:
                continue
            score = SequenceMatcher(None, roster_name, normalized).ratio()
            if len(normalized) >= 3 and (roster_name in normalized or normalized in roster_name):
                score = max(score, 0.90)
            if best is None or score > best[2]:
                best = (entry, candidate_name, score)
    if best is None or best[2] < 0.65:
        return None
    return (best[0], best[1])


def _useful_raw_name(raw_name: str) -> str | None:
    cleaned = _clean_raw_name(raw_name)
    if _name_signal_length(cleaned) < 3:
        return None
    if re.fullmatch(r"[A-Za-z0-9\u0400-\u04ff\u4e00-\u9fff][A-Za-z0-9\u0400-\u04ff\u4e00-\u9fff ]+[A-Za-z0-9\u0400-\u04ff\u4e00-\u9fff]", cleaned) is None:
        return None
    return cleaned


def _clean_raw_name(raw_name: str) -> str:
    cleaned = " ".join(raw_name.strip().split())
    allowed = r"A-Za-z0-9\u0400-\u04ff\u4e00-\u9fff"
    cleaned = re.sub(rf"^[^{allowed}]+", "", cleaned)
    cleaned = re.sub(rf"[^{allowed}]+$", "", cleaned)
    tokens = re.findall(rf"[{allowed}]+", cleaned)
    if not tokens:
        return ""
    useful_tokens = [token for token in tokens if _name_signal_length(token) >= 2]
    if len(useful_tokens) == 1:
        return useful_tokens[0]
    if len(useful_tokens) > 1:
        ordered = sorted(useful_tokens, key=_name_signal_length, reverse=True)
        if _name_signal_length(ordered[0]) >= 10 and _name_signal_length(ordered[0]) >= _name_signal_length(ordered[1]) * 2:
            return ordered[0]
        if all(re.fullmatch(r"[A-Za-z0-9]+", token) for token in useful_tokens):
            return ""
    return " ".join(useful_tokens or tokens)


def _display_name_for_match(match: tuple[object, str] | None, fallback_raw_name: str) -> str | None:
    if match is None:
        return _useful_raw_name(fallback_raw_name)

    roster_name = _roster_name(match)
    useful_raw_name = _useful_raw_name(match[1])
    if roster_name is None:
        return useful_raw_name

    if useful_raw_name is not None and _is_repeated_character_variant(roster_name, useful_raw_name):
        return useful_raw_name

    return roster_name


def _is_repeated_character_variant(base: str, candidate: str) -> bool:
    normalized_base = _normalize_match_text(base)
    normalized_candidate = _normalize_match_text(candidate)
    if not normalized_base or normalized_base == normalized_candidate:
        return False
    return _collapse_repeated_characters(normalized_candidate) == normalized_base


def _collapse_repeated_characters(value: str) -> str:
    collapsed: list[str] = []
    for character in value:
        if collapsed and collapsed[-1] == character:
            continue
        collapsed.append(character)
    return "".join(collapsed)


def _normalize_match_text(value: str | None) -> str:
    normalized = re.sub(r"[^a-z0-9\u0400-\u04ff\u4e00-\u9fff]+", "", (value or "").lower())
    return normalized.translate(str.maketrans({"1": "l", "i": "l", "o": "0"}))


def _name_signal_length(value: str) -> int:
    return len(re.sub(r"[^A-Za-z0-9\u0400-\u04ff\u4e00-\u9fff]+", "", value))


def _roster_name(entry: object | tuple[object, str] | None) -> str | None:
    if isinstance(entry, tuple):
        entry = entry[0]
    return getattr(entry, "name", None) if entry is not None else None


def _roster_player_id(entry: object | tuple[object, str] | None) -> str | None:
    if isinstance(entry, tuple):
        entry = entry[0]
    return getattr(entry, "player_id", None) if entry is not None else None


def _crop(image: object, rect: Rect) -> object:
    return image.crop(_box(rect))


def detect_boss_ranking_rows(path: Path) -> list[BossRankingRow]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildBossDetectionError("Pillow is required to detect guild boss ranking rows.") from exc

    if not path.exists():
        raise FileNotFoundError(path)

    with Image.open(path) as image:
        rgb = image.convert("RGB")
        intervals = _detect_ranking_intervals(rgb)
        bounds = [_detect_row_bounds(rgb, start, end) for start, end in intervals]
        return [BossRankingRow(index=index, bounds=rect, fields=_infer_fields(rect)) for index, rect in enumerate(bounds)]


def extract_boss_rankings_from_screenshots(paths: list[Path], roster: Sequence[object]) -> list[ExtractedBossRanking]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
        import pytesseract  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildBossDetectionError("Pillow and pytesseract are required to extract guild boss rankings.") from exc

    rankings: list[ExtractedBossRanking] = []
    for path in paths:
        rows = detect_boss_ranking_rows(path)
        source_name = _source_name(path)
        with Image.open(path) as image:
            rgb = image.convert("RGB")
            if path == paths[0]:
                rankings.extend(_extract_podium_rankings(rgb, source_name, roster, pytesseract))
            previous_rank: int | None = None
            for row in rows:
                ranking = _extract_list_ranking(rgb, row, source_name, roster, pytesseract, previous_rank)
                if ranking.boss_rank is not None:
                    previous_rank = ranking.boss_rank
                rankings.append(ranking)
    return _repair_rank_damage_order(rankings)


def _source_name(path: Path) -> str:
    if path.parent.name == "boss":
        return str(Path(path.parent.name) / path.name)
    return path.name


def export_boss_ranking_crops(screenshot_path: Path, output_dir: Path) -> list[Path]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildBossDetectionError("Pillow is required to export guild boss ranking crops.") from exc

    rows = detect_boss_ranking_rows(screenshot_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    with Image.open(screenshot_path) as image:
        for row in rows:
            row_path = output_dir / f"boss-row-{row.index:02d}.png"
            image.crop(_box(row.bounds)).save(row_path, format="PNG")
            written.append(row_path)

            for field_name, field in asdict(row.fields).items():
                rect = Rect(**field)
                field_path = output_dir / f"boss-row-{row.index:02d}-{field_name}.png"
                image.crop(_box(rect)).save(field_path, format="PNG")
                written.append(field_path)

    return written


def _extract_list_ranking(
    image: object,
    row: BossRankingRow,
    source_name: str,
    roster: Sequence[object],
    pytesseract: object,
    previous_rank: int | None,
) -> ExtractedBossRanking:
    raw_name_candidates = _boss_name_candidates(image, row, pytesseract, languages=("eng",))
    match = _match_roster_name(raw_name_candidates, roster)
    if match is None:
        raw_name_candidates.extend(
            _boss_name_candidates(image, row, pytesseract, languages=("chi_tra", "chi_sim", "rus", "eng+chi_tra", "eng+chi_sim", "eng+rus"))
        )
        match = _match_roster_name(raw_name_candidates, roster)
    raw_name = _best_text(raw_name_candidates)
    damage_text = _read_boss_damage_text(_crop(image, row.fields.damage), pytesseract)
    if previous_rank is not None:
        rank = previous_rank + 1
    else:
        rank = _read_boss_rank(_crop(image, row.fields.rank), pytesseract)
    matched_raw_name = match[1] if match is not None else raw_name
    return ExtractedBossRanking(
        source=f"{source_name} row {row.index}",
        row_index=row.index,
        area="list",
        boss_rank=rank,
        player_id=_roster_player_id(match) if match is not None else None,
        name=_display_name_for_match(match, raw_name),
        raw_name=matched_raw_name or None,
        damage_text=damage_text,
        boss_damage_today=parse_boss_damage(damage_text) if damage_text else None,
    )


def _repair_rank_damage_order(rankings: list[ExtractedBossRanking]) -> list[ExtractedBossRanking]:
    repaired = list(rankings)
    for _pass in range(3):
        changed = False
        ranked_indexes = sorted(
            [
                index
                for index, ranking in enumerate(repaired)
                if ranking.boss_rank is not None and ranking.boss_damage_today is not None
            ],
            key=lambda index: repaired[index].boss_rank or 0,
        )
        previous_damage: int | None = None
        for index in ranked_indexes:
            ranking = repaired[index]
            current_damage = ranking.boss_damage_today
            if previous_damage is not None and current_damage is not None and previous_damage > current_damage * 100:
                replacement = _upgraded_damage_text(ranking.damage_text, previous_damage)
                if replacement is not None:
                    repaired[index] = replace(
                        ranking,
                        damage_text=replacement,
                        boss_damage_today=parse_boss_damage(replacement),
                    )
                    current_damage = repaired[index].boss_damage_today
                    changed = True
            if previous_damage is not None and current_damage is not None and current_damage > previous_damage:
                replacement = _downgraded_damage_text(ranking.damage_text, previous_damage)
                if replacement is not None:
                    repaired[index] = replace(
                        ranking,
                        damage_text=replacement,
                        boss_damage_today=parse_boss_damage(replacement),
                    )
                    current_damage = repaired[index].boss_damage_today
                    changed = True
            if current_damage is not None:
                previous_damage = current_damage
        if not changed:
            break
    return repaired


def _upgraded_damage_text(damage_text: str | None, maximum: int) -> str | None:
    match = re.fullmatch(r"(\d+(?:\.\d+)?|\.\d+)([Mm])", damage_text or "")
    if match is None:
        return None
    amount = match.group(1)
    candidates = [amount]
    integer, separator, fraction = amount.partition(".")
    candidates.extend(
        f"{integer[offset:]}{separator}{fraction}"
        for offset in range(1, len(integer))
        if integer[offset:] and integer[offset:] != "0"
    )
    for candidate_amount in candidates:
        candidate = f"{candidate_amount}B"
        parsed = parse_boss_damage(candidate)
        if parsed is not None and parsed <= maximum:
            return candidate
    return None


def _downgraded_damage_text(damage_text: str | None, maximum: int) -> str | None:
    match = re.fullmatch(r"(\d+(?:\.\d+)?|\.\d+)([TtBbMm])", damage_text or "")
    if match is None:
        return None
    amount = match.group(1)
    unit = match.group(2).upper()
    candidates = []
    if unit == "T":
        candidates = ["B", "M"]
    elif unit == "B":
        candidates = ["M"]
    for candidate_unit in candidates:
        candidate = f"{amount}{candidate_unit}"
        parsed = parse_boss_damage(candidate)
        if parsed is not None and parsed <= maximum:
            return candidate
    return None


def _boss_name_candidates(image: object, row: BossRankingRow, pytesseract: object, *, languages: tuple[str, ...]) -> list[str]:
    crops = [
        row.fields.name,
        _relative_rect(row.bounds, 0.29, 0.08, 0.38, 0.42),
        _relative_rect(row.bounds, 0.30, 0.02, 0.45, 0.55),
    ]
    candidates: list[str] = []
    for rect in crops:
        candidates.extend(_ocr_name_variants(_crop(image, rect), pytesseract, languages=languages))
    return candidates


def _ocr_name_variants(image: object, pytesseract: object, *, languages: tuple[str, ...]) -> list[str]:
    try:
        from PIL import Image, ImageOps  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildBossDetectionError("Pillow is required to preprocess boss OCR crops.") from exc

    if not isinstance(image, Image.Image):
        raise TypeError("image must be a PIL image")

    gray = ImageOps.grayscale(image)
    prepared = ImageOps.autocontrast(gray.resize((gray.width * 5, gray.height * 5), Image.Resampling.LANCZOS))
    texts: list[str] = []
    for language in languages:
        texts.append(pytesseract.image_to_string(prepared, lang=language, config="--psm 7").strip())
    return texts


def _extract_podium_rankings(image: object, source_name: str, roster: Sequence[object], pytesseract: object) -> list[ExtractedBossRanking]:
    width = image.width
    height = image.height
    specs = [
        (
            1,
            [Rect(round(width * 0.393), round(height * 0.265), round(width * 0.273), round(height * 0.032))],
            Rect(round(width * 0.42), round(height * 0.307), round(width * 0.27), round(height * 0.047)),
        ),
        (
            2,
            [
                Rect(round(width * 0.065), round(height * 0.278), round(width * 0.225), round(height * 0.030)),
                Rect(round(width * 0.055), round(height * 0.272), round(width * 0.255), round(height * 0.040)),
                Rect(round(width * 0.06), round(height * 0.28), round(width * 0.29), round(height * 0.045)),
            ],
            Rect(round(width * 0.16), round(height * 0.324), round(width * 0.18), round(height * 0.035)),
        ),
        (
            3,
            [Rect(round(width * 0.731), round(height * 0.280), round(width * 0.205), round(height * 0.028))],
            Rect(round(width * 0.71), round(height * 0.328), round(width * 0.20), round(height * 0.040)),
        ),
    ]
    rankings: list[ExtractedBossRanking] = []
    for rank, name_rects, damage_rect in specs:
        raw_name_candidates: list[str] = []
        for name_rect in name_rects:
            raw_name_candidates.extend(_ocr_variants(_crop(image, name_rect), pytesseract, psm_values=(7, 8, 13), high_threshold=True))
        raw_name = _best_text(raw_name_candidates)
        damage_text = _read_boss_damage_text(_crop(image, damage_rect), pytesseract)
        match = _match_roster_name(raw_name_candidates, roster)
        matched_raw_name = match[1] if match is not None else raw_name
        rankings.append(
            ExtractedBossRanking(
                source=f"{source_name} podium {rank}",
                row_index=rank - 1,
                area="podium",
                boss_rank=rank,
                player_id=_roster_player_id(match) if match is not None else None,
                name=_display_name_for_match(match, raw_name),
                raw_name=matched_raw_name or None,
                damage_text=damage_text,
                boss_damage_today=parse_boss_damage(damage_text) if damage_text else None,
            )
        )
    return rankings


def _detect_ranking_intervals(image: object) -> list[tuple[int, int]]:
    width = image.width
    height = image.height
    x_start = max(0, int(width * 0.045))
    x_end = min(width, int(width * 0.17))
    y_start = int(height * 0.28)
    y_end = int(height * 0.86)

    row_like_y: list[int] = []
    for y in range(y_start, y_end):
        matches = 0
        samples = 0
        for x in range(x_start, x_end, 5):
            samples += 1
            if _is_ranking_card_pixel(image.getpixel((x, y))):
                matches += 1
        if samples and matches / samples > 0.35:
            row_like_y.append(y)

    intervals = _merge_nearby_values(row_like_y, max_gap=5)
    return [(start, end) for start, end in intervals if 115 <= end - start + 1 <= 180]


def _detect_row_bounds(image: object, y1: int, y2: int) -> Rect:
    xs: list[int] = []
    for x in range(image.width):
        matches = 0
        samples = 0
        for y in range(y1 + 12, y2 - 12, 8):
            samples += 1
            if _is_ranking_card_pixel(image.getpixel((x, y))):
                matches += 1
        if samples and matches / samples >= 0.35:
            xs.append(x)

    if not xs:
        raise GuildBossDetectionError(f"Could not detect boss ranking row bounds for y={y1}..{y2}")

    return Rect(x=min(xs), y=y1, width=max(xs) - min(xs) + 1, height=y2 - y1 + 1)


def _infer_fields(row: Rect) -> BossRankingFields:
    return BossRankingFields(
        rank=_relative_rect(row, 0.03, 0.12, 0.14, 0.70),
        avatar=_relative_rect(row, 0.20, 0.06, 0.15, 0.88),
        name=_relative_rect(row, 0.30, 0.08, 0.43, 0.42),
        damage=_relative_rect(row, 0.77, 0.26, 0.19, 0.42),
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


def _is_ranking_card_pixel(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    return red > 70 and 10 < green < 85 and 30 < blue < 125 and red > green + 25 and red > blue - 5


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Detect guild boss ranking rows in a Monster Invasion screenshot.")
    parser.add_argument("screenshot", type=Path)
    parser.add_argument("--crops-dir", type=Path, help="Optional directory where detected row and field crops are written.")
    args = parser.parse_args(argv)

    rows = detect_boss_ranking_rows(args.screenshot)
    crops = export_boss_ranking_crops(args.screenshot, args.crops_dir) if args.crops_dir else []
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


def _row_to_dict(row: BossRankingRow) -> dict[str, object]:
    return {
        "index": row.index,
        "bounds": asdict(row.bounds),
        "fields": asdict(row.fields),
    }


if __name__ == "__main__":
    raise SystemExit(main())
