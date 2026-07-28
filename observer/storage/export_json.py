from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import date, datetime
from typing import Any

from observer.pipeline.guild_member_ocr import _clean_observed_name, _contains_cjk, _select_observed_name


def database_url_from_env() -> str | None:
    return os.environ.get("ARCHERO_DATABASE_URL") or os.environ.get("DATABASE_URL")


def export_dashboard_payload(dsn: str) -> dict[str, Any]:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - depends on local runtime
        raise RuntimeError("psycopg is required to export dashboard data from PostgreSQL") from exc

    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        payload = {
            "captures": _captures(connection),
            "guildRoster": _guild_roster(connection),
            "memberSnapshots": _member_snapshots(connection),
            "previousMemberSnapshots": [],
            "dailyRawSnapshots": _daily_member_snapshots(connection),
            "dailyBossRawSnapshots": _daily_boss_snapshots(connection),
            "rules": _rules(connection),
            "changes": [],
            "ocrQueue": [],
            "identityLinks": _identity_links(connection),
        }
    return _jsonable(payload)


def _captures(connection) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT capture_batches.captured_at, import_reports.created_at AS imported_at
        FROM import_reports
        JOIN capture_batches ON capture_batches.id = import_reports.batch_id
        ORDER BY import_reports.capture_date DESC, import_reports.created_at DESC
        LIMIT 1
        """
    ).fetchone()
    imported_at = _iso(row["imported_at"]) if row else None
    captured_at = _iso(row["captured_at"]) if row else None
    return {
        "lastCapturedAt": captured_at,
        "lastImportedAt": imported_at,
        "baselineJoinedAt": None,
        "contribution30d": [],
        "averagePower8w": [],
    }


def _guild_roster(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT user_id, current_name, discord_name, discord_linked, status, joined_on, left_on
        FROM guild_members
        ORDER BY current_name
        """
    ).fetchall()
    return [
        {
            "playerId": row["user_id"],
            "name": row["current_name"],
            "discordName": row["discord_name"],
            "discordLinked": row["discord_linked"],
            "status": row["status"],
            "joinedAt": _iso(row["joined_on"]),
            "leftAt": _iso(row["left_on"]),
        }
        for row in rows
    ]


def _member_snapshots(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM (
            SELECT DISTINCT ON (m.user_id)
                   m.user_id, gm.current_name, gs.capture_date,
                   COALESCE(
                       m.role,
                       (
                           SELECT previous.role
                           FROM member_metrics previous
                           JOIN guild_snapshots previous_snapshot ON previous_snapshot.id = previous.snapshot_id
                           WHERE previous.user_id = m.user_id
                             AND previous.role IS NOT NULL
                           ORDER BY previous_snapshot.capture_date DESC, previous_snapshot.id DESC
                           LIMIT 1
                       )
                   ) AS role,
                   m.power,
                   m.contribution_7d, m.boss_attacks, m.last_activity_days,
                   m.verification_note, m.raw_payload
            FROM member_metrics m
            JOIN guild_snapshots gs ON gs.id = m.snapshot_id
            JOIN guild_members gm ON gm.user_id = m.user_id
            ORDER BY m.user_id, gs.capture_date DESC, gs.id DESC
        ) latest
        ORDER BY current_name
        """
    ).fetchall()
    return [_member_snapshot_row(row) for row in rows]


def _daily_member_snapshots(connection) -> list[dict[str, Any]]:
    rows = list(connection.execute(
        """
        SELECT gs.capture_date, gm.current_name, m.user_id, m.role, m.power,
               m.contribution_7d, m.boss_attacks, m.last_activity_days,
               m.verification_note, m.raw_payload
        FROM member_metrics m
        JOIN guild_snapshots gs ON gs.id = m.snapshot_id
        JOIN guild_members gm ON gm.user_id = m.user_id
        ORDER BY gs.capture_date, gm.current_name
        """
    ).fetchall())
    unmatched_table = connection.execute(
        "SELECT to_regclass('public.unmatched_member_metrics') AS table_name"
    ).fetchone()
    if unmatched_table and unmatched_table["table_name"]:
        rows.extend(
            connection.execute(
                """
                SELECT gs.capture_date, u.observed_name AS current_name,
                       NULL::text AS user_id, u.role, u.power,
                       u.contribution_7d, u.boss_attacks, u.last_activity_days,
                       u.verification_note, u.raw_payload
                FROM unmatched_member_metrics u
                JOIN guild_snapshots gs ON gs.id = u.snapshot_id
                ORDER BY gs.capture_date, u.observed_name
                """
            ).fetchall()
        )
    rows.sort(key=lambda row: (row["capture_date"], row.get("current_name") or ""))
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_date[_iso(row["capture_date"])].append(_member_snapshot_row(row))
    return [{"date": day, "rows": rows} for day, rows in sorted(by_date.items())]


def _member_snapshot_row(row: dict[str, Any]) -> dict[str, Any]:
    raw_payload = row.get("raw_payload")
    activity_text = raw_payload.get("activity_text") if isinstance(raw_payload, dict) else None
    source = raw_payload.get("source") if isinstance(raw_payload, dict) else None
    raw_name = raw_payload.get("raw_name") if isinstance(raw_payload, dict) else None
    payload_name = raw_payload.get("name") if isinstance(raw_payload, dict) else None
    detected_name = (
        _clean_observed_name(payload_name)
        if isinstance(payload_name, str) and _contains_cjk(payload_name)
        else _select_observed_name(raw_name.split(" | ")) if isinstance(raw_name, str) else None
    )
    return {
        "playerId": row["user_id"],
        "name": row.get("current_name"),
        "role": row.get("role") or "member",
        "status": "active",
        "lastSeenAt": _iso(row.get("capture_date")),
        "power": row.get("power"),
        "contribution7d": row.get("contribution_7d"),
        "bossAttacks": row.get("boss_attacks"),
        "bossDamageToday": None,
        "lastActivityDays": row.get("last_activity_days"),
        "activityText": activity_text,
        "source": source or row.get("verification_note"),
        "rawName": raw_name,
        "detectedName": detected_name,
        "matchScore": raw_payload.get("match_score") if isinstance(raw_payload, dict) else None,
        "metricsCaptured": True,
        "metricsVerified": True,
    }


def _daily_boss_snapshots(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT capture_date, boss_key, boss_name, user_id, player_name, boss_rank,
               damage_value, damage_text, row_area, row_index
        FROM v_boss_daily_leaderboard
        ORDER BY capture_date, boss_rank NULLS LAST, damage_value DESC
        """
    ).fetchall()
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        day = _iso(row["capture_date"])
        by_date[day].append(
            {
                "source": f"{row['boss_key']} rank {row['boss_rank'] or row['row_index']}",
                "rowIndex": row["row_index"],
                "area": row["row_area"],
                "bossRank": row["boss_rank"],
                "playerId": row["user_id"],
                "name": row["player_name"],
                "rawName": None,
                "damageText": row["damage_text"],
                "bossDamageToday": row["damage_value"],
                "rowLabel": f"Rank {row['boss_rank']}" if row["boss_rank"] else "Boss row",
                "lastSeenAt": day,
            }
        )
    return [{"date": day, "rows": rows} for day, rows in sorted(by_date.items())]


def _rules(connection) -> dict[str, Any]:
    rows = connection.execute("SELECT key, value FROM rule_settings").fetchall()
    return {row["key"]: row["value"] for row in rows}


def _identity_links(connection) -> list[dict[str, Any]]:
    exists = connection.execute("SELECT to_regclass('public.member_identity_links') AS table_name").fetchone()
    if not exists or not exists["table_name"]:
        return []
    rows = connection.execute(
        """
        SELECT normalized_name, observed_name, user_id
        FROM member_identity_links
        ORDER BY observed_name
        """
    ).fetchall()
    return [
        {
            "normalizedName": row["normalized_name"],
            "observedName": row["observed_name"],
            "playerId": row["user_id"],
        }
        for row in rows
    ]


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).decode("utf-8")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).decode("utf-8")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export dashboard data from PostgreSQL as JSON.")
    parser.add_argument("--dsn", default=database_url_from_env())
    args = parser.parse_args(argv)
    if not args.dsn:
        raise SystemExit("ARCHERO_DATABASE_URL or DATABASE_URL is required")
    print(json.dumps(export_dashboard_payload(args.dsn), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
