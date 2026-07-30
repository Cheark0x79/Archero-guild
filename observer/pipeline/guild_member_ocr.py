from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from observer.pipeline.image_geometry import normalize_analysis_image
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
    power_text: str | None = None
    activity_text: str | None = None
    role_text: str | None = None
    raw_activity: str = ""
    raw_role: str = ""


def extract_member_metrics_from_screenshots(paths: list[Path], roster: list[RosterEntry]) -> list[ExtractedMemberMetrics]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
        import pytesseract  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberOcrError("Pillow and pytesseract are required to extract guild member metrics.") from exc

    extracted_by_player: dict[str, ExtractedMemberMetrics] = {}
    unmatched_rows: list[ExtractedMemberMetrics] = []
    unresolved_rows: list[ExtractedMemberMetrics] = []
    for path in paths:
        rows = detect_member_rows(path)
        with Image.open(path) as image:
            rgb = normalize_analysis_image(image)
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
        if _raw_name_has_signal(metrics.raw_name):
            # A readable name that is absent from the roster is probably a new
            # or renamed member. Never attach it to an unrelated member merely
            # because their power values happen to be close.
            unresolved_rows.append(metrics)
            continue
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
            power_text=metrics.power_text,
            activity_text=metrics.activity_text,
            role_text=metrics.role_text,
        )

    return [*extracted_by_player.values(), *unresolved_rows]


def _extract_row_metrics(image: object, row: MemberRow, source_name: str, roster: list[RosterEntry], pytesseract: object) -> ExtractedMemberMetrics | None:
    primary_name_crop = _crop_rect(image, row.fields.name)
    raw_names = [
        _ocr_text(primary_name_crop, pytesseract),
        _ocr_text(_relative_crop(image, row.bounds, 0.49, 0.14, 0.34, 0.38), pytesseract),
        _ocr_text(_relative_crop(image, row.bounds, 0.47, 0.18, 0.38, 0.34), pytesseract),
        _ocr_text(_relative_crop(image, row.bounds, 0.38, 0.16, 0.46, 0.36), pytesseract),
        _ocr_text(_relative_crop(image, row.bounds, 0.20, 0.12, 0.68, 0.40), pytesseract),
    ]
    match = _match_roster_name(raw_names, roster)
    multilingual_observed_name: str | None = None
    if match is None and any(re.search(r"[\u0400-\u04ff]", entry.name) for entry in roster):
        russian_name = _ocr_text(primary_name_crop, pytesseract, language="rus")
        if russian_name:
            russian_roster = [entry for entry in roster if re.search(r"[\u0400-\u04ff]", entry.name)]
            match = _match_roster_name([russian_name], russian_roster)
    if match is None and _should_try_cjk_ocr(raw_names, roster):
        chinese_roster = [entry for entry in roster if _contains_cjk(entry.name)]
        for language in ("chi_tra", "chi_sim"):
            chinese_name = _clean_observed_name(_ocr_text(primary_name_crop, pytesseract, language=language))
            if not _contains_cjk(chinese_name):
                continue
            match = _match_roster_name([chinese_name], chinese_roster)
            if match is not None:
                break
            if multilingual_observed_name is None:
                multilingual_observed_name = chinese_name
    parsed_power = _read_power(image, row, pytesseract)
    status_text = _ocr_text(_relative_crop(image, row.bounds, 0.84, 0.04, 0.14, 0.34), pytesseract)
    parsed_role, role_text = _read_role(image, row, pytesseract)
    parsed_donation = _read_donation(image, row, pytesseract)
    parsed_boss = _read_boss_tries(image, row, pytesseract)
    parsed_activity = _parse_visible_activity_days(status_text)

    if match is None:
        observed_name = multilingual_observed_name or _select_observed_name(raw_names)
        raw_name_candidates = [multilingual_observed_name, *raw_names] if multilingual_observed_name else raw_names
        return ExtractedMemberMetrics(
            player_id="",
            name=observed_name,
            role=parsed_role,
            power=parsed_power,
            donation=parsed_donation,
            boss_tries=parsed_boss,
            last_activity_days=parsed_activity,
            source=f"{source_name} row {row.index}",
            match_score=0.0,
            raw_name=" | ".join(raw_name_candidates),
            power_text=format_game_power(parsed_power),
            activity_text=format_activity_text(status_text, parsed_activity),
            role_text=format_role_text(parsed_role),
            raw_activity=status_text,
            raw_role=role_text,
        )

    entry, score, raw_name = match

    return ExtractedMemberMetrics(
        player_id=entry.player_id,
        name=entry.name,
        role=parsed_role,
        power=parsed_power,
        donation=parsed_donation,
        boss_tries=parsed_boss,
        last_activity_days=parsed_activity,
        source=f"{source_name} row {row.index}",
        match_score=score,
        raw_name=_clean_observed_name(raw_name),
        power_text=format_game_power(parsed_power),
        activity_text=format_activity_text(status_text, parsed_activity),
        role_text=format_role_text(parsed_role),
        raw_activity=status_text,
        raw_role=role_text,
    )


def _parse_visible_activity_days(status_text: str) -> int | None:
    # The game hides the "last active" duration while a member is currently
    # online. A visible member row with an empty status area therefore means
    # active today, not missing data.
    if not status_text.strip():
        return 0
    return parse_activity_days(status_text)


def _ocr_text(
    image: object,
    pytesseract: object,
    *,
    whitelist: str | None = None,
    language: str | None = None,
) -> str:
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
    return pytesseract.image_to_string(prepared, config=config, lang=language).strip()


def _read_role(image: object, row: MemberRow, pytesseract: object) -> tuple[str | None, str]:
    try:
        from PIL import Image, ImageOps  # type: ignore[import-not-found]
    except ImportError as exc:
        raise GuildMemberOcrError("Pillow is required to preprocess role OCR crops.") from exc

    crop = _crop_rect(image, row.fields.role).convert("RGB")
    variants = [
        crop.resize((crop.width * 4, crop.height * 4), Image.Resampling.BICUBIC),
        ImageOps.autocontrast(
            ImageOps.grayscale(crop).resize((crop.width * 4, crop.height * 4), Image.Resampling.BICUBIC)
        ),
        ImageOps.autocontrast(
            crop.getchannel("R").resize((crop.width * 4, crop.height * 4), Image.Resampling.BICUBIC)
        ),
        ImageOps.autocontrast(
            crop.getchannel("G").resize((crop.width * 4, crop.height * 4), Image.Resampling.BICUBIC)
        ),
    ]
    candidates = [
        pytesseract.image_to_string(variant, config="--psm 7").strip()
        for variant in variants
    ]
    parsed = [(role, text) for text in candidates if (role := _parse_role(text)) is not None]
    for preferred_role in ("officer", "leader", "elder", "member"):
        for role, text in parsed:
            if role == preferred_role:
                return role, text
    return None, next((text for text in candidates if text), "")


def _relative_crop(image: object, row: Rect, x: float, y: float, width: float, height: float) -> object:
    crop = Rect(
        x=row.x + round(row.width * x),
        y=row.y + round(row.height * y),
        width=round(row.width * width),
        height=round(row.height * height),
    )
    return image.crop((crop.x, crop.y, crop.right, crop.bottom))


def _crop_rect(image: object, rect: Rect) -> object:
    return image.crop((rect.x, rect.y, rect.right, rect.bottom))


def _read_power(image: object, row: MemberRow, pytesseract: object) -> int | None:
    crops = [
        ((0.275, 0.55, 0.16, 0.37), True),
        ((0.265, 0.58, 0.17, 0.34), True),
        ((0.25, 0.56, 0.20, 0.38), True),
        ((0.22, 0.58, 0.22, 0.35), False),
        ((0.18, 0.58, 0.28, 0.35), False),
        ((0.19, 0.60, 0.25, 0.31), False),
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
    # Keep the crop tightly around the digits. Wider crops include the green
    # donation icon on the left and the empty progress bar on the right. Those
    # shapes made Tesseract turn 850/590 into 0 and 550 into 5500.
    crops = [
        (0.715, 0.56, 0.12, 0.38),
        (0.720, 0.56, 0.12, 0.38),
        (0.715, 0.58, 0.13, 0.34),
        (0.720, 0.58, 0.13, 0.34),
        (0.710, 0.54, 0.14, 0.42),
    ]
    candidates: list[int] = []
    for crop in crops:
        candidates.extend(_read_integer_candidates(_relative_crop(image, row.bounds, *crop), pytesseract))

    candidates = [candidate for candidate in candidates if 0 <= candidate <= 20_000]
    if not candidates:
        return None
    return _select_integer_candidate(candidates)


def _read_boss_tries(image: object, row: MemberRow, pytesseract: object) -> int | None:
    crops = [
        (0.49, 0.56, 0.15, 0.38),
        (0.505, 0.56, 0.17, 0.38),
        (0.49, 0.58, 0.19, 0.34),
    ]
    candidates: list[int] = []
    for crop in crops:
        text = _ocr_text(
            _relative_crop(image, row.bounds, *crop),
            pytesseract,
            whitelist="0123456789time(s)",
        )
        value = parse_integer(text)
        if value is not None:
            candidates.append(value)
    candidates = [candidate for candidate in candidates if 0 <= candidate <= 10]
    return _select_integer_candidate(candidates) if candidates else None


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
        for normalized in _normalized_name_candidates(raw_name):
            for entry in roster:
                roster_name = _normalize_match_text(entry.name)
                if not roster_name:
                    continue
                score = SequenceMatcher(None, roster_name, normalized).ratio()
                if len(normalized) >= 3 and (roster_name in normalized or normalized in roster_name):
                    score = max(score, 0.98)
                if best is None or score > best[1]:
                    best = (entry, score, raw_name)

    if best is None or best[1] < 0.70:
        return None
    return best


def _normalize_match_text(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9\u0400-\u04ff\u4e00-\u9fff]+", "", value.lower())
    return normalized.translate(str.maketrans({"1": "l", "i": "l", "o": "0"}))


def _normalized_name_candidates(value: str) -> list[str]:
    normalized = _normalize_match_text(value)
    candidates = [normalized] if normalized else []
    stripped = normalized
    for prefix in ("guildmembers", "members", "member", "bers", "ers", "pers"):
        if stripped.startswith(prefix):
            stripped = stripped[len(prefix):]
            if stripped:
                candidates.append(stripped)
            break
    return list(dict.fromkeys(candidates))


def _select_observed_name(raw_names: list[str]) -> str:
    candidates = [
        (index, cleaned, _normalize_match_text(cleaned))
        for index, value in enumerate(raw_names[:4])
        if (cleaned := _clean_observed_name(value))
        and _normalize_match_text(cleaned)
    ]
    if not candidates:
        return ""

    counts: dict[str, int] = {}
    for _index, _cleaned, normalized in candidates:
        counts[normalized] = counts.get(normalized, 0) + 1
    repeated = max(counts, key=counts.get)
    if counts[repeated] > 1:
        return next(cleaned for _index, cleaned, normalized in candidates if normalized == repeated)

    priority = {3: 0.03, 0: 0.02, 1: 0.01, 2: 0.0}
    scored = [
        (
            sum(SequenceMatcher(None, normalized, other_normalized).ratio() for _other_index, _other, other_normalized in candidates)
            + priority.get(index, 0.0),
            -index,
            cleaned,
        )
        for index, cleaned, normalized in candidates
    ]
    return max(scored)[2]


def _clean_observed_name(value: str) -> str:
    cleaned = " ".join(str(value or "").split())
    cleaned = re.sub(r"^[\s'\"`´‘’“”|\\/:;,.+*?_-]*(?:guild\s*members?|members?|bers|ers|pers)\b[\s'\"`´‘’“”|\\/:;,.+*?_-]*", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace("|", "").replace("\\", "")
    cleaned = re.sub(r"^[^\w\u0400-\u04ff\u4e00-\u9fff]+", "", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"[^\w\u0400-\u04ff\u4e00-\u9fff]+$", "", cleaned, flags=re.UNICODE)
    return " ".join(cleaned.split())


def _contains_cjk(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", value))


def _should_try_cjk_ocr(raw_names: list[str], roster: list[RosterEntry]) -> bool:
    # The English model can turn an entire Chinese name into one plausible
    # Latin token. Do not use that noisy token to decide whether the Chinese
    # model is allowed to run: once regular matching failed, the presence of a
    # CJK roster entry is the reliable signal.
    return any(_contains_cjk(entry.name) for entry in roster)


def _raw_name_has_signal(value: str) -> bool:
    return any(
        candidates and len(candidates[-1]) >= 3
        for part in value.split("|")
        if (candidates := _normalized_name_candidates(part))
    )


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
    normalized = _normalize_activity_ocr(normalized)
    day_match = re.search(r"(\d+)\s*d", normalized)
    if day_match:
        return int(day_match.group(1))
    if re.search(r"\d+\s*[hm]", normalized):
        return 0
    return None


def format_activity_text(raw_value: str, days: int | None) -> str | None:
    normalized = raw_value.strip().lower()
    if not normalized or "online" in normalized or "onl" in normalized:
        return "Online"
    normalized = _normalize_activity_ocr(normalized)
    day_match = re.search(r"(\d+)\s*d", normalized)
    hour_match = re.search(r"(\d+)\s*h", normalized)
    if day_match:
        parts = [f"{int(day_match.group(1))} d"]
        if hour_match:
            parts.append(f"{int(hour_match.group(1))} h")
        return " ".join(parts)
    if hour_match:
        return f"{int(hour_match.group(1))} h"
    minute_match = re.search(r"(\d+)\s*m", normalized)
    if minute_match:
        return f"{int(minute_match.group(1))} min"
    return f"{days} days" if days is not None else None


def _normalize_activity_ocr(value: str) -> str:
    def normalize_day_token(match: re.Match[str]) -> str:
        digits = match.group(1).translate(str.maketrans({"o": "0", "i": "1", "l": "1"}))
        return f"{digits}d"

    normalized = re.sub(r"\b([0-9oil]+)\s*d\b", normalize_day_token, value.lower())
    return re.sub(
        r"\b([0-9oil]+)\s*([hm])\b",
        lambda match: (
            match.group(1).translate(str.maketrans({"o": "0", "i": "1", "l": "1"}))
            + match.group(2)
        ),
        normalized,
    )


def format_game_power(value: int | None) -> str | None:
    if value is None:
        return None
    unit, divisor = ("M", 1_000_000) if value >= 1_000_000 else ("K", 1_000)
    amount = value / divisor
    text = f"{amount:.2f}".rstrip("0").rstrip(".")
    return f"{text}{unit}"


def format_role_text(role: str | None) -> str | None:
    return {
        "leader": "Leader",
        "officer": "Vice-leader",
        "elder": "Elder",
        "member": "Guild member",
    }.get(role)


def _parse_role(value: str) -> str | None:
    normalized = value.lower()
    if any(marker in normalized for marker in ("vice", "vce", "mice", "nice")) and "leader" in normalized:
        return "officer"
    if "leader" in normalized:
        return "leader"
    if "elder" in normalized:
        return "elder"
    if "member" in normalized or "guild" in normalized or "mem" in normalized:
        return "member"
    return None
