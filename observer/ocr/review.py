from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from observer.pipeline.guild_boss import parse_boss_damage
from observer.pipeline.guild_member_ocr import (
    format_activity_text,
    format_game_power,
    format_role_text,
    parse_activity_days,
    parse_power,
)


class ReviewError(RuntimeError):
    pass


MEMBER_FIELDS = {
    "playerId",
    "rawName",
    "name",
    "role",
    "powerText",
    "activityText",
    "contribution7d",
    "bossAttacks",
}
BOSS_FIELDS = {
    "rank",
    "playerId",
    "rawName",
    "name",
    "damageText",
    "area",
}
ROLES = {"leader", "officer", "elder", "member"}
BOSS_AREAS = {"podium", "list"}


def merge_reviewed_scope(existing: dict[str, Any] | None, incoming: dict[str, Any]) -> dict[str, Any]:
    """Replace one extracted scope while preserving the other reviewed scope."""
    incoming_kinds = {
        image.get("kind")
        for image in incoming.get("sourceImages", [])
        if isinstance(image, dict)
    }
    if len(incoming_kinds) != 1:
        raise ReviewError("a scope extraction must contain exactly one source kind")
    if not existing:
        refresh_reviewed_batch(incoming)
        return incoming
    if existing.get("captureDate") != incoming.get("captureDate"):
        raise ReviewError("cannot merge OCR scopes from different dates")

    kind = next(iter(incoming_kinds))
    merged = deepcopy(existing)
    merged["generatedAt"] = incoming["generatedAt"]
    merged["agentVersion"] = incoming["agentVersion"]
    merged["sourceImages"] = [
        image for image in merged.get("sourceImages", [])
        if isinstance(image, dict) and image.get("kind") != kind
    ] + deepcopy(incoming["sourceImages"])
    rows_key = "members" if kind == "guild-members" else "bossRankings"
    merged[rows_key] = deepcopy(incoming[rows_key])
    merged.setdefault("members", [])
    merged.setdefault("bossRankings", [])
    refresh_reviewed_batch(merged)
    return merged


def prepare_export_batch(batch: dict[str, Any], capture_date: str) -> dict[str, Any]:
    """Apply the user-selected business date without mutating the local review."""
    exported = deepcopy(batch)
    exported["captureDate"] = capture_date
    refresh_reviewed_batch(exported)
    return exported


def remove_reviewed_scope(
    batch_path: Path,
    corrections_path: Path,
    capture_date: str,
    kind: str,
) -> dict[str, bool]:
    """Invalidate only the scope whose screenshots are being replaced."""
    if not batch_path.exists():
        return {"batch": False, "corrections": False}
    batch = _load_batch(batch_path, capture_date)
    category = "members" if kind == "guild-members" else "bosses"
    rows_key = "members" if category == "members" else "bossRankings"
    batch["sourceImages"] = [
        image for image in batch.get("sourceImages", [])
        if isinstance(image, dict) and image.get("kind") != kind
    ]
    batch[rows_key] = []
    if not batch["sourceImages"]:
        return clear_reviewed_data(batch_path, corrections_path, capture_date)
    refresh_reviewed_batch(batch)
    _atomic_json_write(batch_path, batch)

    corrections_changed = False
    if corrections_path.exists():
        log = load_review_log(corrections_path, capture_date)
        retained = [entry for entry in log["entries"] if entry.get("category") != category]
        corrections_changed = len(retained) != len(log["entries"])
        log["entries"] = retained
        _atomic_json_write(corrections_path, log)
    return {"batch": True, "corrections": corrections_changed}


def load_review_log(path: Path, capture_date: str) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": 1, "captureDate": capture_date, "updatedAt": None, "entries": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReviewError(f"{path} is not a valid correction log") from exc
    if not isinstance(payload, dict) or payload.get("captureDate") != capture_date:
        raise ReviewError(f"{path} does not contain correction date {capture_date}")
    if not isinstance(payload.get("entries"), list):
        raise ReviewError(f"{path} does not contain correction entries")
    return payload


def confirmed_departure_ids(correction_log: dict[str, Any]) -> set[str]:
    decisions: dict[str, bool] = {}
    for entry in correction_log.get("entries", []):
        if not isinstance(entry, dict) or entry.get("action") != "departure":
            continue
        player_id = str(entry.get("playerId") or "").strip()
        if player_id:
            decisions[player_id] = entry.get("confirmed") is True
    return {player_id for player_id, confirmed in decisions.items() if confirmed}


def record_departure_decision(
    corrections_path: Path,
    *,
    capture_date: str,
    player_id: str,
    name: str,
    confirmed: bool,
) -> dict[str, Any]:
    normalized_id = str(player_id or "").strip()
    normalized_name = str(name or "").strip()
    if not normalized_id or not normalized_name:
        raise ReviewError("a roster player ID and name are required")
    correction_log = load_review_log(corrections_path, capture_date)
    current = normalized_id in confirmed_departure_ids(correction_log)
    if current == confirmed:
        return correction_log
    timestamp = datetime.now(ZoneInfo("Europe/Paris")).isoformat()
    correction_log["updatedAt"] = timestamp
    correction_log["entries"].append(
        {
            "at": timestamp,
            "action": "departure",
            "category": "members",
            "source": "synchronized roster",
            "field": "rosterPresence",
            "playerId": normalized_id,
            "name": normalized_name,
            "confirmed": confirmed,
            "before": "missing member" if confirmed else "confirmed departure",
            "after": "confirmed departure" if confirmed else "missing member",
        }
    )
    _atomic_json_write(corrections_path, correction_log)
    return correction_log


def apply_batch_edit(
    batch_path: Path,
    corrections_path: Path,
    *,
    capture_date: str,
    category: str,
    row_index: int,
    field: str,
    value: object,
) -> tuple[dict[str, Any], dict[str, Any]]:
    batch = _load_batch(batch_path, capture_date)
    rows_key, allowed_fields = _category(category)
    rows = batch.get(rows_key)
    if not isinstance(rows, list) or row_index < 0 or row_index >= len(rows):
        raise ReviewError("the selected OCR row no longer exists")
    if field not in allowed_fields:
        raise ReviewError(f"{field} cannot be edited for {category}")
    row = rows[row_index]
    if not isinstance(row, dict):
        raise ReviewError("the selected OCR row is invalid")

    before = row.get(field)
    normalized = _normalized_value(category, field, value)
    if before == normalized:
        return batch, load_review_log(corrections_path, capture_date)
    if field == "playerId" and normalized and any(
        index != row_index
        and isinstance(item, dict)
        and item.get("playerId") == normalized
        for index, item in enumerate(rows)
    ):
        raise ReviewError(f"player ID {normalized} is already used by another reviewed row")

    row[field] = normalized
    _refresh_derived_fields(category, row, field, normalized)
    refresh_reviewed_batch(batch)

    correction_log = load_review_log(corrections_path, capture_date)
    timestamp = datetime.now(ZoneInfo("Europe/Paris")).isoformat()
    correction_log["updatedAt"] = timestamp
    correction_log["entries"].append(
        {
            "at": timestamp,
            "category": category,
            "rowIndex": row_index,
            "source": row.get("source"),
            "field": field,
            "before": before,
            "after": normalized,
        }
    )
    _atomic_json_write(batch_path, batch)
    _atomic_json_write(corrections_path, correction_log)
    return batch, correction_log


def link_member_identity(
    batch_path: Path,
    corrections_path: Path,
    *,
    capture_date: str,
    row_index: int,
    player_id: str,
    canonical_name: str,
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """Attach a canonical roster identity to one existing OCR metrics row."""
    batch = _load_batch(batch_path, capture_date)
    rows = batch.get("members")
    if not isinstance(rows, list) or row_index < 0 or row_index >= len(rows):
        raise ReviewError("the selected OCR row no longer exists")
    row = rows[row_index]
    if not isinstance(row, dict):
        raise ReviewError("the selected OCR row is invalid")

    normalized_id = str(player_id or "").strip()
    normalized_name = str(canonical_name or "").strip()
    if not normalized_id or not normalized_name:
        raise ReviewError("a roster player ID and canonical name are required")
    if any(
        index != row_index
        and isinstance(item, dict)
        and str(item.get("playerId") or "").strip() == normalized_id
        for index, item in enumerate(rows)
    ):
        raise ReviewError(f"player ID {normalized_id} is already used by another reviewed row")

    observed_name = str(row.get("rawName") or row.get("name") or "").strip() or None
    before = {
        "playerId": row.get("playerId"),
        "name": row.get("name"),
    }
    row["playerId"] = normalized_id
    row["name"] = normalized_name
    row["matchScore"] = 1
    row["matchType"] = "manual"
    row["matchStatus"] = "matched"
    refresh_reviewed_batch(batch)

    correction_log = load_review_log(corrections_path, capture_date)
    timestamp = datetime.now(ZoneInfo("Europe/Paris")).isoformat()
    correction_log["updatedAt"] = timestamp
    correction_log["entries"].append(
        {
            "at": timestamp,
            "action": "link",
            "category": "members",
            "rowIndex": row_index,
            "source": row.get("source"),
            "field": "identity",
            "before": before,
            "after": {"playerId": normalized_id, "name": normalized_name},
            "observedName": observed_name,
        }
    )
    _atomic_json_write(batch_path, batch)
    _atomic_json_write(corrections_path, correction_log)
    return batch, correction_log, observed_name


def delete_batch_row(
    batch_path: Path,
    corrections_path: Path,
    *,
    capture_date: str,
    category: str,
    row_index: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    batch = _load_batch(batch_path, capture_date)
    rows_key, _ = _category(category)
    expected_kind = "guild-members" if category == "members" else "guild-boss"
    source_kinds = {
        image.get("kind")
        for image in batch.get("sourceImages", [])
        if isinstance(image, dict)
    }
    if expected_kind not in source_kinds:
        raise ReviewError(f"cannot delete {category} rows from a batch without that source")
    rows = batch.get(rows_key)
    if not isinstance(rows, list) or row_index < 0 or row_index >= len(rows):
        raise ReviewError("the selected OCR row no longer exists")
    row = rows[row_index]
    if not isinstance(row, dict):
        raise ReviewError("the selected OCR row is invalid")

    deleted = rows.pop(row_index)
    _decrement_detected_rows(batch, category, deleted)
    refresh_reviewed_batch(batch)

    correction_log = load_review_log(corrections_path, capture_date)
    timestamp = datetime.now(ZoneInfo("Europe/Paris")).isoformat()
    correction_log["updatedAt"] = timestamp
    correction_log["entries"].append(
        {
            "at": timestamp,
            "action": "delete",
            "category": category,
            "rowIndex": row_index,
            "source": deleted.get("source"),
            "field": "row",
            "before": deleted,
            "after": None,
        }
    )
    _atomic_json_write(batch_path, batch)
    _atomic_json_write(corrections_path, correction_log)
    return batch, correction_log


def add_batch_row(
    batch_path: Path,
    corrections_path: Path,
    *,
    capture_date: str,
    category: str,
    initial: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    batch = _load_batch(batch_path, capture_date)
    rows_key, _ = _category(category)
    rows = batch.get(rows_key)
    if not isinstance(rows, list):
        raise ReviewError(f"{rows_key} is not a valid review table")
    initial = initial if isinstance(initial, dict) else {}
    if category == "members":
        row = _new_member_row(initial)
        if row["playerId"] and any(item.get("playerId") == row["playerId"] for item in rows if isinstance(item, dict)):
            raise ReviewError("this member already exists in the reviewed batch")
    else:
        row = _new_boss_row(initial)
    rows.append(row)
    refresh_reviewed_batch(batch)

    correction_log = load_review_log(corrections_path, capture_date)
    timestamp = datetime.now(ZoneInfo("Europe/Paris")).isoformat()
    correction_log["updatedAt"] = timestamp
    correction_log["entries"].append(
        {
            "at": timestamp,
            "action": "add",
            "category": category,
            "rowIndex": len(rows) - 1,
            "source": row.get("source"),
            "field": "row",
            "before": None,
            "after": row,
        }
    )
    _atomic_json_write(batch_path, batch)
    _atomic_json_write(corrections_path, correction_log)
    return batch, correction_log


def refresh_reviewed_batch(batch: dict[str, Any]) -> None:
    members = batch.get("members") if isinstance(batch.get("members"), list) else []
    bosses = batch.get("bossRankings") if isinstance(batch.get("bossRankings"), list) else []
    rows = [*members, *bosses]
    complete = sum(_member_complete(row) for row in members) + sum(_boss_complete(row) for row in bosses)
    completeness = complete / len(rows) if rows else 0
    quality = batch.setdefault("quality", {})
    # Member screenshots overlap while scrolling just like Boss screenshots.
    # Rows are already deduplicated by identity during extraction, so summing
    # every detected rectangle creates false coverage gaps. Roster differences
    # are reviewed separately through the missing-member workflow.
    member_expected = len(members)

    boss_ranks = [
        row.get("rank")
        for row in bosses
        if isinstance(row, dict)
        and isinstance(row.get("rank"), int)
        and not isinstance(row.get("rank"), bool)
        and row["rank"] > 0
    ]
    # Boss screenshots intentionally overlap while scrolling. The highest rank,
    # not the sum of every detected rectangle, is the expected participant count.
    boss_expected = max([len(bosses), *boss_ranks], default=0)
    if boss_expected <= 0 and any(
        isinstance(image, dict) and image.get("kind") == "guild-boss"
        for image in batch.get("sourceImages", [])
    ):
        boss_expected = 1

    reviewed_expected = member_expected + boss_expected
    quality["memberExpectedRows"] = member_expected
    quality["bossExpectedRows"] = boss_expected
    quality["reviewedExpectedRows"] = reviewed_expected
    quality["memberCoverage"] = 1 if members else 0
    quality["bossCoverage"] = round(min(1, len(bosses) / boss_expected), 6) if boss_expected else 0
    coverage = (
        min(1, len(rows) / reviewed_expected)
        if isinstance(reviewed_expected, int) and reviewed_expected > 0
        else 0
    )
    quality["coverage"] = round(coverage, 6)
    quality["completeness"] = round(completeness, 6)
    quality["status"] = "pass" if rows and coverage == 1 and completeness == 1 else "review"
    incomplete = len(rows) - complete
    quality["warnings"] = [] if incomplete == 0 else [f"{incomplete} extracted row(s) still require manual correction."]
    digest = hashlib.sha256(_canonical_json({**batch, "idempotencyKey": ""})).hexdigest()
    batch["idempotencyKey"] = f"{batch['captureDate']}:{digest}"


def _decrement_detected_rows(batch: dict[str, Any], category: str, row: dict[str, Any]) -> None:
    expected_kind = "guild-members" if category == "members" else "guild-boss"
    source = str(row.get("source") or "")
    images = [
        image
        for image in batch.get("sourceImages", [])
        if isinstance(image, dict) and image.get("kind") == expected_kind
    ]
    matching = next(
        (
            image
            for image in images
            if image.get("sourceName") and str(image["sourceName"]) in source
        ),
        None,
    )
    image = matching or (images[0] if len(images) == 1 else None)
    if image is not None:
        image["detectedRows"] = max(0, int(image.get("detectedRows") or 0) - 1)


def clear_reviewed_data(batch_path: Path, corrections_path: Path, capture_date: str) -> dict[str, bool]:
    removed = {"batch": False, "corrections": False}
    for key, path in (("batch", batch_path), ("corrections", corrections_path)):
        if path.exists():
            path.unlink()
            removed[key] = True
    return removed


def _load_batch(path: Path, capture_date: str) -> dict[str, Any]:
    try:
        batch = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ReviewError("run OCR extraction before editing rows") from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReviewError(f"{path} is not a valid OCR batch") from exc
    if not isinstance(batch, dict) or batch.get("captureDate") != capture_date:
        raise ReviewError(f"{path} does not contain capture date {capture_date}")
    return batch


def _category(category: str) -> tuple[str, set[str]]:
    if category == "members":
        return "members", MEMBER_FIELDS
    if category == "bosses":
        return "bossRankings", BOSS_FIELDS
    raise ReviewError("category must be members or bosses")


def _normalized_value(category: str, field: str, value: object) -> object:
    text = "" if value is None else str(value).strip()
    if field in {"playerId", "rawName", "name"}:
        return text or None
    if field == "role":
        normalized = text.lower()
        if normalized not in ROLES:
            raise ReviewError("role must be leader, officer, elder, or member")
        return normalized
    if field == "area":
        normalized = text.lower()
        if normalized not in BOSS_AREAS:
            raise ReviewError("boss area must be podium or list")
        return normalized
    if field == "powerText":
        parsed = parse_power(text)
        if parsed is None:
            raise ReviewError("power must look like 815.49K or 1.42M")
        return format_game_power(parsed)
    if field == "activityText":
        days = parse_activity_days(text)
        if days is None:
            raise ReviewError("connection must look like Online, 15 min, 10 h, or 1 d 10 h")
        return format_activity_text(text, days)
    if field == "damageText":
        parsed = parse_boss_damage(text)
        if parsed is None:
            raise ReviewError("damage must look like 615.55M, 2.27B, or 1.3T")
        return text.upper().replace(",", ".")
    if field in {"contribution7d", "bossAttacks", "rank"}:
        try:
            number = int(text.replace(" ", "").replace(",", ""))
        except ValueError as exc:
            raise ReviewError(f"{field} must be an integer") from exc
        maximum = 10 if field == "bossAttacks" else 100 if field == "rank" else 10_000_000
        minimum = 1 if field == "rank" else 0
        if number < minimum or number > maximum:
            raise ReviewError(f"{field} must be between {minimum} and {maximum}")
        return number
    raise ReviewError(f"{field} cannot be edited")


def _refresh_derived_fields(category: str, row: dict[str, Any], field: str, value: object) -> None:
    if category == "members":
        if field == "powerText":
            row["power"] = parse_power(str(value))
        elif field == "activityText":
            row["lastActivityDays"] = parse_activity_days(str(value))
            row["rawActivity"] = str(value)
        elif field == "role":
            row["roleText"] = format_role_text(str(value))
        if field in {"playerId", "name"}:
            row["matchScore"] = 1 if row.get("playerId") and row.get("name") else 0
    elif field == "damageText":
        row["damage"] = parse_boss_damage(str(value))


def _new_member_row(initial: dict[str, Any]) -> dict[str, Any]:
    player_id = str(initial.get("playerId") or "").strip() or None
    name = str(initial.get("name") or "").strip() or None
    power = initial.get("power")
    power = power if isinstance(power, int) and power >= 0 else None
    return {
        "playerId": player_id,
        "rawName": name,
        "name": name,
        "role": "member",
        "roleText": "Guild member",
        "powerText": format_game_power(power) if power is not None else None,
        "power": power,
        "activityText": None,
        "rawActivity": None,
        "lastActivityDays": None,
        "contribution7d": None,
        "bossAttacks": None,
        "source": "manual review",
        "matchScore": 1 if player_id and name else 0,
    }


def _new_boss_row(initial: dict[str, Any]) -> dict[str, Any]:
    player_id = str(initial.get("playerId") or "").strip() or None
    name = str(initial.get("name") or "").strip() or None
    return {
        "rank": None,
        "playerId": player_id,
        "rawName": name,
        "name": name,
        "damageText": None,
        "damage": None,
        "area": "list",
        "source": "manual review",
    }


def _member_complete(row: object) -> bool:
    if not isinstance(row, dict):
        return False
    return (
        isinstance(row.get("name"), str)
        and bool(row["name"].strip())
        and row.get("role") in ROLES
        and all(isinstance(row.get(field), int) for field in ("power", "contribution7d", "bossAttacks", "lastActivityDays"))
    )


def _boss_complete(row: object) -> bool:
    if not isinstance(row, dict):
        return False
    return (
        isinstance(row.get("name"), str)
        and bool(row["name"].strip())
        and isinstance(row.get("rank"), int)
        and isinstance(row.get("damage"), int)
        and isinstance(row.get("damageText"), str)
        and bool(row["damageText"].strip())
    )


def _atomic_json_write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{hashlib.sha256(str(path).encode()).hexdigest()[:8]}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
