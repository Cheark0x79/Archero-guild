from __future__ import annotations

import argparse
import json
import re
from datetime import date
from typing import Any

from archero_guild.storage.persistence import database_url_from_env

EDITABLE_FIELDS = (
    "level", "memberCount", "memberCapacity", "totalPower", "xpCurrent", "xpRequired",
    "expeditionPoints", "expeditionName", "expeditionRank",
)


def normalize_snapshot_edit(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("snapshot edit must be an object")
    capture_date = str(value.get("date", "")).strip()
    if not _valid_date(capture_date):
        raise ValueError("date must use YYYY-MM-DD format")
    reason = str(value.get("reason") or "Manual daily editor correction").strip()
    if len(reason) > 500:
        raise ValueError("reason must not exceed 500 characters")
    numeric_limits = {
        "level": (1, 1_000), "memberCount": (0, 1_000), "memberCapacity": (1, 1_000),
        "totalPower": (0, 10_000_000_000_000), "xpCurrent": (0, 10_000_000_000),
        "xpRequired": (1, 10_000_000_000), "expeditionPoints": (0, 10_000_000_000),
    }
    numbers = {}
    for field, (minimum, maximum) in numeric_limits.items():
        if field not in value:
            raise ValueError(f"{field} is required")
        candidate = value[field]
        if candidate is None and field != "resultId":
            numbers[field] = None
            continue
        if isinstance(candidate, bool) or not isinstance(candidate, int) or not minimum <= candidate <= maximum:
            raise ValueError(f"{field} must be an integer between {minimum} and {maximum}")
        numbers[field] = candidate
    if numbers["memberCount"] is not None and numbers["memberCapacity"] is not None and numbers["memberCount"] > numbers["memberCapacity"]:
        raise ValueError("memberCount cannot exceed memberCapacity")
    name = value.get("expeditionName")
    if name is not None and not isinstance(name, str):
        raise ValueError("expeditionName must be text or null")
    name = name.strip() if name is not None else None
    if name is not None and (not name or len(name) > 128):
        raise ValueError("expeditionName must be between 1 and 128 characters")
    rank = value.get("expeditionRank")
    if rank is not None and not isinstance(rank, str):
        raise ValueError("expeditionRank must be text or null")
    rank = rank.strip().upper() if rank is not None else None
    if rank is not None and (not rank or not re.fullmatch(r"(?:X{0,2}(?:IX|IV|V?I{0,3})|XXX)", rank)):
        raise ValueError("expeditionRank must be a Roman numeral from I to XXX")
    return {
        "date": capture_date,
        "reason": reason,
        **numbers,
        "expeditionName": name,
        "expeditionRank": rank,
    }


def update_snapshot(dsn: str, value: Any) -> dict[str, Any]:
    edit = normalize_snapshot_edit(value)
    member_edits = _normalize_member_edits(value.get("memberEdits"))
    boss_edits = _normalize_boss_edits(value.get("bossEdits"))
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("psycopg is required to edit guild statistics") from exc
    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS guild_stat_snapshot_edits (
                    id BIGSERIAL PRIMARY KEY,
                    capture_date DATE NOT NULL REFERENCES guild_stat_snapshots(capture_date) ON DELETE RESTRICT,
                    previous_payload JSONB NOT NULL,
                    updated_payload JSONB NOT NULL,
                    reason TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
            row = cursor.execute("SELECT * FROM guild_stat_snapshots WHERE capture_date = %s FOR UPDATE", (edit["date"],)).fetchone()
            if not row:
                raise ValueError("no guild statistics snapshot exists for this date; import the daily capture first")
            previous = dict(row["raw_payload"]) if isinstance(row["raw_payload"], dict) else {}
            columns = {"level": "guild_level", "memberCount": "member_count", "memberCapacity": "member_capacity",
                       "totalPower": "total_power", "xpCurrent": "xp_current", "xpRequired": "xp_required",
                       "expeditionPoints": "expedition_points", "expeditionName": "expedition_name", "expeditionRank": "expedition_rank"}
            for field, column in columns.items():
                previous[field] = row[column] if row[column] is not None else previous.get(field)
            updated = {**previous, **{field: edit[field] for field in EDITABLE_FIELDS}}
            cursor.execute("""
                UPDATE guild_stat_snapshots
                SET guild_level = %s, member_count = %s, member_capacity = %s, total_power = %s,
                    xp_current = %s, xp_required = %s, expedition_points = %s,
                    expedition_name = %s, expedition_rank = %s,
                    raw_payload = %s::jsonb, updated_at = now()
                WHERE capture_date = %s
            """, (edit["level"], edit["memberCount"], edit["memberCapacity"], edit["totalPower"], edit["xpCurrent"], edit["xpRequired"], edit["expeditionPoints"], edit["expeditionName"], edit["expeditionRank"], json.dumps(updated), edit["date"]))
            cursor.execute("""
                INSERT INTO guild_stat_snapshot_edits (capture_date, previous_payload, updated_payload, reason)
                VALUES (%s, %s::jsonb, %s::jsonb, %s)
            """, (edit["date"], json.dumps(previous), json.dumps(updated), edit["reason"]))
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS daily_snapshot_row_edits (
                    id BIGSERIAL PRIMARY KEY,
                    capture_date DATE NOT NULL,
                    entity_type TEXT NOT NULL CHECK (entity_type IN ('member', 'boss')),
                    entity_key TEXT NOT NULL,
                    previous_payload JSONB NOT NULL,
                    updated_payload JSONB NOT NULL,
                    reason TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
            for member in member_edits:
                rows = cursor.execute("""
                    SELECT m.power, m.contribution_7d, m.boss_attacks, m.last_activity_days, m.raw_payload
                    FROM member_metrics m JOIN guild_snapshots s ON s.id = m.snapshot_id
                    WHERE s.capture_date = %s AND m.user_id = %s FOR UPDATE
                """, (edit["date"], member["playerId"])).fetchall()
                if len(rows) > 1:
                    raise ValueError("multiple member captures exist for this date; correction is ambiguous")
                if not rows:
                    raise ValueError(f"member {member['playerId']} was not captured on this date")
                previous_member = dict(rows[0])
                raw_payload = dict(previous_member["raw_payload"] or {})
                if previous_member["last_activity_days"] != member["lastActivityDays"]:
                    raw_payload.pop("activity_text", None)
                updated_member = {"power": member["power"], "contribution_7d": member["contribution7d"],
                                  "boss_attacks": member["bossAttacks"], "last_activity_days": member["lastActivityDays"],
                                  "raw_payload": raw_payload}
                cursor.execute("""
                    UPDATE member_metrics SET power = %s, contribution_7d = %s,
                        boss_attacks = %s, last_activity_days = %s, raw_payload = %s::jsonb
                    FROM guild_snapshots s WHERE member_metrics.snapshot_id = s.id
                      AND s.capture_date = %s AND member_metrics.user_id = %s
                """, (member["power"], member["contribution7d"], member["bossAttacks"], member["lastActivityDays"], json.dumps(raw_payload), edit["date"], member["playerId"]))
                cursor.execute("""INSERT INTO daily_snapshot_row_edits
                    (capture_date, entity_type, entity_key, previous_payload, updated_payload, reason)
                    VALUES (%s, 'member', %s, %s::jsonb, %s::jsonb, %s)""",
                    (edit["date"], member["playerId"], json.dumps(previous_member), json.dumps(updated_member), edit["reason"]))
            # Lock the entire captured day before checking final rank uniqueness.
            # Release edited ranks together so valid swaps do not hit the immediate index.
            if boss_edits:
                rows = cursor.execute("""SELECT id, boss_key, damage_value, damage_text, boss_rank
                    FROM boss_daily_results WHERE capture_date = %s ORDER BY id FOR UPDATE""",
                    (edit["date"],)).fetchall()
                by_id = {row["id"]: row for row in rows}
                changes = {boss["resultId"]: boss for boss in boss_edits}
                if len(changes) != len(boss_edits):
                    raise ValueError("duplicate boss result target")
                if any(result_id not in by_id for result_id in changes):
                    raise ValueError("boss result was not captured on this date")
                final_ranks = set()
                for row in rows:
                    rank = changes[row["id"]]["bossRank"] if row["id"] in changes else row["boss_rank"]
                    key = (row["boss_key"], rank)
                    if rank is not None:
                        if key in final_ranks:
                            raise ValueError("duplicate final boss rank for this captured boss")
                        final_ranks.add(key)
                cursor.execute("UPDATE boss_daily_results SET boss_rank = NULL WHERE id = ANY(%s)", (list(changes),))
                for result_id, boss in changes.items():
                    row = by_id[result_id]
                    previous_boss = {field: row[field] for field in ("damage_value", "damage_text", "boss_rank")}
                    updated_boss = {"damage_value": boss["bossDamageToday"], "boss_rank": boss["bossRank"],
                                    "damage_text": row["damage_text"] if row["damage_value"] == boss["bossDamageToday"] else None}
                    cursor.execute("UPDATE boss_daily_results SET damage_value = %s, damage_text = %s, boss_rank = %s WHERE id = %s",
                                   (updated_boss["damage_value"], updated_boss["damage_text"], updated_boss["boss_rank"], result_id))
                    cursor.execute("""INSERT INTO daily_snapshot_row_edits
                        (capture_date, entity_type, entity_key, previous_payload, updated_payload, reason)
                        VALUES (%s, 'boss', %s, %s::jsonb, %s::jsonb, %s)""",
                        (edit["date"], str(result_id), json.dumps(previous_boss), json.dumps(updated_boss), edit["reason"]))
        connection.commit()
    return {**{field: edit[field] for field in ("date", *EDITABLE_FIELDS)}, "memberEdits": len(member_edits), "bossEdits": len(boss_edits)}


def _normalize_member_edits(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError("memberEdits must contain at most 100 captured members")
    result = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("playerId"), str) or not item["playerId"].strip():
            raise ValueError("each member edit requires a playerId")
        result.append({"playerId": item["playerId"].strip(), **_integer_fields(item, {
            "power": (0, 10_000_000_000_000), "contribution7d": (0, 10_000_000_000),
            "bossAttacks": (0, 1_000_000), "lastActivityDays": (0, 100_000),
        })})
    return result


def _normalize_boss_edits(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 500:
        raise ValueError("bossEdits must contain at most 500 captured results")
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("each boss edit must be an object")
        result.append(_integer_fields(item, {"resultId": (1, 9_000_000_000_000_000), "bossDamageToday": (0, 10_000_000_000_000), "bossRank": (1, 1_000_000)}))
    return result


def _integer_fields(value: dict[str, Any], limits: dict[str, tuple[int, int]]) -> dict[str, int]:
    result = {}
    for field, (minimum, maximum) in limits.items():
        if field not in value:
            raise ValueError(f"{field} is required")
        candidate = value[field]
        if candidate is None and field != "resultId":
            result[field] = None
            continue
        if isinstance(candidate, bool) or not isinstance(candidate, int) or not minimum <= candidate <= maximum:
            raise ValueError(f"{field} must be an integer between {minimum} and {maximum}")
        result[field] = candidate
    return result


def _valid_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value))
    except ValueError:
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Update an audited guild expedition snapshot.")
    parser.add_argument("--dsn", default=database_url_from_env())
    parser.add_argument("--set-json", required=True)
    args = parser.parse_args(argv)
    if not args.dsn:
        raise SystemExit("ARCHERO_DATABASE_URL or DATABASE_URL is required")
    try:
        snapshot = update_snapshot(args.dsn, json.loads(args.set_json))
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    except Exception:
        print(json.dumps({"error": "Unable to save snapshot; no changes were applied."}))
        return 1
    print(json.dumps({"snapshot": snapshot}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
