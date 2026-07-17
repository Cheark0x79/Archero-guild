from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from observer.pipeline.guild_members import MemberRow, Rect, detect_member_rows


class GuildMemberOcrError(RuntimeError):
    pass


@dataclass(frozen=True)
class RosterEntry:
    player_id: str
    name: str
    power_hint: int | None = None


@dataclass(frozen=True)
class ExtractedMemberMetrics:
    player_id: str
    name: str
    role: str | None
    power: int | None
    donation: int | None
    boss_tries: int | None
    last_activity_days: int | None
    source: str
    match_score: float
    raw_name: str


def extract_member_metrics_from_screenshots(paths: list[Path], roster: list[RosterEntry]) -> list[ExtractedMemberMetrics]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
        import pytesseract  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberOcrError("Pillow and pytesseract are required to extract guild member metrics.") from exc

    extracted_by_player: dict[str, ExtractedMemberMetrics] = {}
    unmatched_rows: list[ExtractedMemberMetrics] = []
    for path in paths:
        rows = detect_member_rows(path)
        with Image.open(path) as image:
            rgb = image.convert("RGB")
            for row in rows:
                metrics = _extract_row_metrics(rgb, row, path.name, roster, pytesseract)
                if metrics is None:
                    continue
                if metrics.player_id == "":
                    unmatched_rows.append(metrics)
                    continue
                if metrics.player_id in extracted_by_player:
                    continue
                extracted_by_player[metrics.player_id] = metrics

    for metrics in unmatched_rows:
        fallback = _match_by_power(metrics.power, roster, set(extracted_by_player))
        if fallback is None:
            continue
        extracted_by_player[fallback.player_id] = ExtractedMemberMetrics(
            player_id=fallback.player_id,
            name=fallback.name,
            role=metrics.role,
            power=metrics.power,
            donation=metrics.donation,
            boss_tries=metrics.boss_tries,
            last_activity_days=metrics.last_activity_days,
            source=metrics.source,
            match_score=0.50,
            raw_name=metrics.raw_name,
        )

    return list(extracted_by_player.values())


def _extract_row_metrics(image: object, row: MemberRow, source_name: str, roster: list[RosterEntry], pytesseract: object) -> ExtractedMemberMetrics | None:
    raw_names = [
        _ocr_text(_relative_crop(image, row.bounds, 0.31, 0.15, 0.48, 0.36), pytesseract),
        _ocr_text(_relative_crop(image, row.bounds, 0.40, 0.14, 0.42, 0.38), pytesseract),
        _ocr_text(_relative_crop(image, row.bounds, 0.38, 0.20, 0.46, 0.32), pytesseract),
        _ocr_text(_relative_crop(image, row.bounds, 0.20, 0.12, 0.68, 0.40), pytesseract),
    ]
    match = _match_roster_name(raw_names, roster)
    parsed_power = _read_power(image, row, pytesseract)
    boss_text = _ocr_text(_relative_crop(image, row.bounds, 0.49, 0.61, 0.15, 0.29), pytesseract, whitelist="0123456789time(s)")
    status_text = _ocr_text(_relative_crop(image, row.bounds, 0.82, 0.02, 0.17, 0.36), pytesseract)
    role_text = _ocr_text(_relative_crop(image, row.bounds, 0.19, 0.18, 0.28, 0.36), pytesseract)
    parsed_donation = _read_donation(image, row, pytesseract)
    parsed_boss = parse_integer(boss_text)
    parsed_activity = parse_activity_days(status_text)

    if match is None:
        return ExtractedMemberMetrics(
            player_id="",
            name="",
            role=_parse_role(role_text),
            power=parsed_power,
            donation=parsed_donation,
            boss_tries=parsed_boss,
            last_activity_days=parsed_activity,
            source=f"{source_name} row {row.index}",
            match_score=0.0,
            raw_name=" | ".join(raw_names),
        )

    entry, score, raw_name = match

    return ExtractedMemberMetrics(
        player_id=entry.player_id,
        name=entry.name,
        role=_parse_role(role_text),
        power=parsed_power,
        donation=parsed_donation,
        boss_tries=parsed_boss,
        last_activity_days=parsed_activity,
        source=f"{source_name} row {row.index}",
        match_score=score,
        raw_name=raw_name,
    )


def _ocr_text(image: object, pytesseract: object, *, whitelist: str | None = None) -> str:
    try:
        from PIL import Image, ImageOps  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberOcrError("Pillow is required to preprocess OCR crops.") from exc

    if not isinstance(image, Image.Image):
        raise TypeError("image must be a PIL image")

    gray = ImageOps.grayscale(image)
    enlarged = gray.resize((gray.width * 4, gray.height * 4), Image.Resampling.LANCZOS)
    prepared = ImageOps.autocontrast(enlarged)
    config = "--psm 7"
    if whitelist is not None:
        config += f" -c tessedit_char_whitelist={whitelist}"
    return pytesseract.image_to_string(prepared, config=config).strip()


def _relative_crop(image: object, row: Rect, x: float, y: float, width: float, height: float) -> object:
    crop = Rect(
        x=row.x + round(row.width * x),
        y=row.y + round(row.height * y),
        width=round(row.width * width),
        height=round(row.height * height),
    )
    return image.crop((crop.x, crop.y, crop.right, crop.bottom))


def _read_power(image: object, row: MemberRow, pytesseract: object) -> int | None:
    crops = [
        ((0.22, 0.58, 0.22, 0.35), True),
        ((0.18, 0.58, 0.28, 0.35), True),
        ((0.20, 0.58, 0.24, 0.35), True),
        ((0.19, 0.60, 0.25, 0.31), False),
        ((0.265, 0.62, 0.16, 0.28), False),
    ]
    candidates: list[tuple[int, bool, bool]] = []
    for crop, is_trusted in crops:
        text = _ocr_text(_relative_crop(image, row.bounds, *crop), pytesseract, whitelist="0123456789.KMm")
        value = parse_power(text)
        if value is not None and 10_000 <= value <= 20_000_000:
            candidates.append((value, is_trusted, _has_decimal_power_text(text)))

    if not candidates:
        return None

    return _select_power_cluster(candidates)


def _select_power_cluster(candidates: list[tuple[int, bool, bool]]) -> int:
    clusters: list[list[tuple[int, bool, bool]]] = []
    for candidate in sorted(candidates, key=lambda item: item[0]):
        for cluster in clusters:
            center = sum(value for value, _, _ in cluster) / len(cluster)
            if abs(candidate[0] - center) / max(candidate[0], center) <= 0.20:
                cluster.append(candidate)
                break
        else:
            clusters.append([candidate])

    clusters.sort(
        key=lambda cluster: (
            sum(1 for _, is_trusted, _ in cluster if is_trusted),
            sum(1 for _, _, has_decimal in cluster if has_decimal),
            len(cluster),
            -_cluster_spread([value for value, _, _ in cluster]),
        ),
        reverse=True,
    )
    return _select_power_candidate(
        [value for value, _, _ in clusters[0]],
        [value for value, _, has_decimal in candidates if has_decimal] + [value for value, _, has_decimal in candidates if not has_decimal],
    )


def _read_donation(image: object, row: MemberRow, pytesseract: object) -> int | None:
    crops = [
        (0.715, 0.60, 0.22, 0.30),
        (0.700, 0.58, 0.24, 0.34),
        (0.730, 0.60, 0.18, 0.30),
    ]
    candidates: list[int] = []
    for crop in crops:
        candidates.extend(_read_integer_candidates(_relative_crop(image, row.bounds, *crop), pytesseract))

    candidates = [candidate for candidate in candidates if 0 <= candidate <= 20_000]
    if not candidates:
        return None
    return _select_integer_candidate(candidates)


def _read_integer_candidates(image: object, pytesseract: object) -> list[int]:
    try:
        from PIL import Image, ImageOps  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberOcrError("Pillow is required to preprocess OCR crops.") from exc

    if not isinstance(image, Image.Image):
        raise TypeError("image must be a PIL image")

    gray = ImageOps.grayscale(image)
    variants = [
        (ImageOps.autocontrast(gray.resize((gray.width * 3, gray.height * 3), Image.Resampling.LANCZOS)), "--psm 13"),
        (ImageOps.autocontrast(gray.resize((gray.width * 4, gray.height * 4), Image.Resampling.LANCZOS)), "--psm 13"),
        (ImageOps.autocontrast(gray.resize((gray.width * 4, gray.height * 4), Image.Resampling.LANCZOS)), "--psm 7"),
    ]
    threshold_base = ImageOps.autocontrast(gray.resize((gray.width * 4, gray.height * 4), Image.Resampling.LANCZOS))
    variants.extend(
        [
            (threshold_base.point(lambda pixel: 255 if pixel > 100 else 0), "--psm 7"),
            (threshold_base.point(lambda pixel: 255 if pixel > 120 else 0), "--psm 7"),
            (threshold_base.point(lambda pixel: 255 if pixel > 140 else 0), "--psm 13"),
        ]
    )

    candidates: list[int] = []
    for prepared, psm in variants:
        text = pytesseract.image_to_string(prepared, config=f"{psm} -c tessedit_char_whitelist=0123456789").strip()
        value = parse_integer(text)
        if value is not None:
            candidates.append(value)
    return candidates


def _select_integer_candidate(candidates: list[int]) -> int:
    counts: dict[int, int] = {}
    for candidate in candidates:
        counts[candidate] = counts.get(candidate, 0) + 1
    return sorted(counts.items(), key=lambda item: (item[1], item[0]), reverse=True)[0][0]


def _select_power_candidate(candidates: list[int], priority_order: list[int] | None = None) -> int:
    counts: dict[int, int] = {}
    for candidate in candidates:
        counts[candidate] = counts.get(candidate, 0) + 1
    most_common = sorted(counts.items(), key=lambda item: (item[1], item[0]), reverse=True)
    if most_common and most_common[0][1] > 1:
        return most_common[0][0]

    if priority_order is not None:
        candidate_set = set(candidates)
        for candidate in priority_order:
            if candidate in candidate_set:
                return candidate

    ordered = sorted(candidates)
    return ordered[len(ordered) // 2]


def _cluster_spread(candidates: list[int]) -> float:
    if len(candidates) <= 1:
        return 0
    return (max(candidates) - min(candidates)) / max(candidates)


def _match_roster_name(raw_names: list[str], roster: list[RosterEntry]) -> tuple[RosterEntry, float, str] | None:
    best: tuple[RosterEntry, float, str] | None = None
    for raw_name in raw_names:
        normalized = _normalize_match_text(raw_name)
        for entry in roster:
            roster_name = _normalize_match_text(entry.name)
            if not roster_name:
                continue
            score = SequenceMatcher(None, roster_name, normalized).ratio()
            if roster_name in normalized:
                score = max(score, 0.98)
            if best is None or score > best[1]:
                best = (entry, score, raw_name)

    if best is None or best[1] < 0.70:
        return None
    return best


def _normalize_match_text(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "", value.lower())
    return normalized.translate(str.maketrans({"1": "l", "i": "l"}))


def _match_by_power(power: int | None, roster: list[RosterEntry], used_player_ids: set[str]) -> RosterEntry | None:
    if power is None or power < 10_000 or power > 20_000_000:
        return None

    candidates: list[tuple[float, RosterEntry]] = []
    for entry in roster:
        if entry.player_id in used_player_ids or entry.power_hint is None:
            continue
        distance = abs(power - entry.power_hint) / max(power, entry.power_hint)
        if distance <= 0.20:
            candidates.append((distance, entry))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    if len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 0.03:
        return None
    return candidates[0][1]


def parse_power(value: str) -> int | None:
    normalized = (
        value.replace("O", "0")
        .replace("o", "0")
        .replace("l", "1")
        .replace("I", "1")
        .replace(",", ".")
    )
    matches = list(re.finditer(r"(\d+(?:\.\d+)?)\s*([KkMm])", normalized))
    if not matches:
        return None
    match = matches[-1]
    amount = float(match.group(1))
    unit = match.group(2).upper()
    return round(amount * (1_000_000 if unit == "M" else 1_000))


def _has_decimal_power_text(value: str) -> bool:
    normalized = (
        value.replace("O", "0")
        .replace("o", "0")
        .replace("l", "1")
        .replace("I", "1")
        .replace(",", ".")
    )
    return bool(re.search(r"\d+\.\d+\s*[KkMm]", normalized))


def parse_integer(value: str) -> int | None:
    normalized = value.replace("O", "0").replace("o", "0")
    match = re.search(r"\d+", normalized)
    return int(match.group(0)) if match else None


def parse_activity_days(value: str) -> int | None:
    normalized = value.lower()
    if "online" in normalized or "onl" in normalized:
        return 0
    if re.search(r"\d+\s*[hm]", normalized):
        return 0
    day_match = re.search(r"(\d+)\s*d", normalized)
    if day_match:
        return int(day_match.group(1))
    return None


def _parse_role(value: str) -> str | None:
    normalized = value.lower()
    if "leader" in normalized and "vice" not in normalized:
        return "leader"
    if "vice" in normalized:
        return "officer"
    if "elder" in normalized:
        return "elder"
    if "member" in normalized:
        return "member"
    return None
