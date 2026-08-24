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
        candidate = value.get(field)
        if isinstance(candidate, bool) or not isinstance(candidate, int) or not minimum <= candidate <= maximum:
            raise ValueError(f"{field} must be an integer between {minimum} and {maximum}")
        numbers[field] = candidate
    if numbers["memberCount"] > numbers["memberCapacity"]:
        raise ValueError("memberCount cannot exceed memberCapacity")
    name = str(value.get("expeditionName", "")).strip()
    if not name or len(name) > 128:
        raise ValueError("expeditionName must be between 1 and 128 characters")
    rank = str(value.get("expeditionRank", "")).strip().upper()
    if not re.fullmatch(r"[IVX]{1,5}", rank):
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
            row = cursor.execute("SELECT raw_payload FROM guild_stat_snapshots WHERE capture_date = %s FOR UPDATE", (edit["date"],)).fetchone()
            if not row:
                raise ValueError("no guild statistics snapshot exists for this date; import the daily capture first")
            previous = row["raw_payload"] if isinstance(row["raw_payload"], dict) else {}
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
        connection.commit()
    return {field: edit[field] for field in ("date", *EDITABLE_FIELDS)}


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
    print(json.dumps({"snapshot": update_snapshot(args.dsn, json.loads(args.set_json))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
