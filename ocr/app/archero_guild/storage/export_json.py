from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from archero_guild.pipeline.guild_member_ocr import _clean_observed_name, _contains_cjk, _select_observed_name
from archero_guild.storage.rules import read_rules


def database_url_from_env() -> str | None:
    return os.environ.get("ARCHERO_DATABASE_URL") or os.environ.get("DATABASE_URL")


def export_dashboard_payload(dsn: str) -> dict[str, Any]:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - depends on local runtime
        raise RuntimeError("psycopg is required to export dashboard data from PostgreSQL") from exc

    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        member_snapshots, previous_member_snapshots = _member_snapshot_sets(connection)
        payload = {
            "captures": _captures(connection),
            "guildRoster": _guild_roster(connection),
            "memberSnapshots": member_snapshots,
            "previousMemberSnapshots": previous_member_snapshots,
            "dailyRawSnapshots": _daily_member_snapshots(connection),
            "dailyBossRawSnapshots": _daily_boss_snapshots(connection),
            "bossDefinitions": _boss_definitions(connection),
            "rules": _rules(connection, dsn),
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
    guild_stats_history = _guild_stats_history(connection)
    guild_stats = guild_stats_history[-1] if guild_stats_history else None
    return {
        "guildName": guild_stats.get("guildName") if guild_stats else None,
        "lastCapturedAt": captured_at,
        "lastImportedAt": imported_at,
        "baselineJoinedAt": None,
        "contribution30d": [],
        "averagePower8w": [],
        "guildStats": guild_stats,
        "guildStatsHistory": guild_stats_history,
    }


def _guild_stats_history(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT capture_date, guild_name, guild_id, guild_level, member_count,
               member_capacity, total_power, donations_value, guild_rank,
               xp_current, xp_required, raw_payload
        FROM guild_stat_snapshots
        ORDER BY capture_date
        """
    ).fetchall()
    history: list[dict[str, Any]] = []
    for row in rows:
        raw_payload = row.get("raw_payload") if isinstance(row.get("raw_payload"), dict) else {}
        history.append({
            "date": _iso(row["capture_date"]),
            "guildName": row.get("guild_name"),
            "guildId": row.get("guild_id"),
            "level": row.get("guild_level"),
            "memberCount": row.get("member_count"),
            "memberCapacity": row.get("member_capacity"),
            "totalPower": row.get("total_power"),
            "donationsValue": row.get("donations_value"),
            "rank": row.get("guild_rank"),
            "xpCurrent": row.get("xp_current"),
            "xpRequired": row.get("xp_required"),
            "expeditionPoints": raw_payload.get("expeditionPoints"),
            "expeditionName": raw_payload.get("expeditionName"),
            "expeditionRank": raw_payload.get("expeditionRank"),
        })
    return history


def _guild_roster(connection) -> list[dict[str, Any]]:
    name_rows = connection.execute(
        """
        SELECT user_id, name
        FROM member_names
        ORDER BY user_id, first_seen_at, name
        """
    ).fetchall()
    names_by_member: dict[str, list[str]] = defaultdict(list)
    for row in name_rows:
        names_by_member[row["user_id"]].append(row["name"])

    rows = connection.execute(
        """
        SELECT user_id, current_name, discord_name, discord_linked, status,
               joined_on, left_on, metadata
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
            "previousNames": _previous_names(row["current_name"], names_by_member[row["user_id"]]),
            "searchAliases": _search_aliases(row["metadata"]),
        }
        for row in rows
    ]


def _previous_names(current_name: str, names: list[str]) -> list[str]:
    return _unique_strings(
        name for name in names
        if name.casefold() != current_name.casefold()
    )


def _search_aliases(metadata: Any) -> list[str]:
    if not isinstance(metadata, dict):
        return []
    values: list[Any] = []
    for key in ("searchAliases", "search_aliases", "aliases"):
        candidate = metadata.get(key)
        if isinstance(candidate, list):
            values.extend(candidate)
        elif isinstance(candidate, str):
            values.append(candidate)
    return _unique_strings(values)


def _unique_strings(values: Any) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        key = normalized.casefold()
        if not normalized or key in seen:
            continue
        seen.add(key)
        unique.append(normalized)
    return unique


def _member_snapshot_sets(connection) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = connection.execute(
        """
        SELECT m.user_id, gm.current_name, gs.capture_date, gs.captured_at,
               m.role, m.power, m.contribution_7d, m.boss_attacks,
               COALESCE(
                   m.boss_damage_today,
                   (
                       SELECT max(result.damage_value)
                       FROM boss_daily_results result
                       WHERE result.user_id = m.user_id
                         AND result.capture_date = gs.capture_date
                   )
               ) AS boss_damage_today,
               m.last_activity_days, m.verification_note, m.raw_payload
        FROM member_metrics m
        JOIN guild_snapshots gs ON gs.id = m.snapshot_id
        JOIN guild_members gm ON gm.user_id = m.user_id
        ORDER BY m.user_id, gs.capture_date, gs.captured_at
        """
    ).fetchall()
    histories: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        histories[row["user_id"]].append(row)

    current: list[dict[str, Any]] = []
    previous: list[dict[str, Any]] = []
    for history in histories.values():
        latest_row = history[-1]
        previous_row = history[-2] if len(history) > 1 else None
        current.append(_member_snapshot_row(latest_row, previous_row=previous_row, history=history))
        if previous_row is not None:
            earlier_row = history[-3] if len(history) > 2 else None
            previous.append(_member_snapshot_row(previous_row, previous_row=earlier_row, history=history[:-1]))
    current.sort(key=lambda row: (row.get("name") or "").casefold())
    previous.sort(key=lambda row: (row.get("name") or "").casefold())
    return current, previous


def _daily_member_snapshots(connection) -> list[dict[str, Any]]:
    rows = list(connection.execute(
        """
        SELECT gs.capture_date, gs.captured_at, gm.current_name, m.user_id,
               m.role, m.power, m.contribution_7d, m.boss_attacks,
               COALESCE(
                   m.boss_damage_today,
                   (
                       SELECT max(result.damage_value)
                       FROM boss_daily_results result
                       WHERE result.user_id = m.user_id
                         AND result.capture_date = gs.capture_date
                   )
               ) AS boss_damage_today,
               m.last_activity_days, m.verification_note, m.raw_payload
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
                SELECT gs.capture_date, gs.captured_at,
                       u.observed_name AS current_name, NULL::text AS user_id,
                       u.role, u.power, u.contribution_7d, u.boss_attacks,
                       NULL::bigint AS boss_damage_today, u.last_activity_days,
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


def _member_snapshot_row(
    row: dict[str, Any],
    *,
    previous_row: dict[str, Any] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
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
    snapshot = {
        "playerId": row["user_id"],
        "name": row.get("current_name"),
        "role": row.get("role") or "member",
        "status": "active",
        "lastSeenAt": _iso(row.get("capture_date")),
        "power": row.get("power"),
        "contribution7d": row.get("contribution_7d"),
        "bossAttacks": row.get("boss_attacks"),
        "bossDamageToday": row.get("boss_damage_today"),
        "lastActivityDays": row.get("last_activity_days"),
        "activityText": activity_text,
        "source": source or row.get("verification_note"),
        "rawName": raw_name,
        "detectedName": detected_name,
        "matchScore": raw_payload.get("match_score") if isinstance(raw_payload, dict) else None,
        "metricsCaptured": True,
        "metricsVerified": True,
        "verificationNote": row.get("verification_note") or "",
    }
    snapshot["powerDelta"] = _numeric_delta(row.get("power"), previous_row, "power")
    snapshot["contributionDelta"] = _counter_delta(
        row.get("contribution_7d"),
        previous_row,
        "contribution_7d",
        current_date=row.get("capture_date"),
        reset_each_week=True,
    )
    snapshot["bossAttacksDelta"] = _counter_delta(
        row.get("boss_attacks"),
        previous_row,
        "boss_attacks",
        current_date=row.get("capture_date"),
    )
    snapshot["power14dPercent"] = _power_growth_percent(row, history or [])
    if previous_row is not None:
        snapshot["previousSnapshot"] = {
            "power": previous_row.get("power"),
            "contribution7d": previous_row.get("contribution_7d"),
            "bossAttacks": previous_row.get("boss_attacks"),
            "lastSeenAt": _iso(previous_row.get("capture_date")),
        }
    return snapshot


def _numeric_delta(current: Any, previous_row: dict[str, Any] | None, key: str) -> int | float | None:
    previous = previous_row.get(key) if previous_row else None
    if not isinstance(current, (int, float)) or not isinstance(previous, (int, float)):
        return None
    return current - previous


def _counter_delta(
    current: Any,
    previous_row: dict[str, Any] | None,
    key: str,
    *,
    current_date: Any,
    reset_each_week: bool = False,
) -> int | float | None:
    delta = _numeric_delta(current, previous_row, key)
    if delta is None:
        return None
    if reset_each_week and previous_row and _week_start(current_date) != _week_start(previous_row.get("capture_date")):
        return None
    return delta if delta >= 0 else None


def _power_growth_percent(row: dict[str, Any], history: list[dict[str, Any]]) -> float | None:
    current_power = row.get("power")
    current_date = row.get("capture_date")
    if not isinstance(current_power, (int, float)) or not isinstance(current_date, date):
        return None
    cutoff = current_date - timedelta(days=14)
    baselines = [
        item for item in history
        if isinstance(item.get("capture_date"), date)
        and item["capture_date"] <= cutoff
        and isinstance(item.get("power"), (int, float))
        and item["power"] > 0
    ]
    if not baselines:
        return None
    baseline = baselines[-1]["power"]
    return round((current_power - baseline) / baseline * 100, 2)


def _week_start(value: Any) -> date | None:
    if not isinstance(value, date):
        return None
    return value - timedelta(days=value.weekday())


def _daily_boss_snapshots(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT capture_date, boss_key, boss_name, weekday, user_id, player_name,
               boss_rank, damage_value, damage_text, row_area, row_index
        FROM v_boss_daily_leaderboard
        ORDER BY capture_date, boss_rank NULLS LAST, damage_value DESC
        """
    ).fetchall()
    by_boss_day: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        day = _iso(row["capture_date"])
        key = (day, row["boss_key"])
        group = by_boss_day.setdefault(
            key,
            {
                "date": day,
                "bossKey": row["boss_key"],
                "boss": {
                    "key": row["boss_key"],
                    "name": row["boss_name"],
                    "weekday": row["weekday"],
                },
                "rows": [],
            },
        )
        group["rows"].append(
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
    return [
        group
        for _, group in sorted(by_boss_day.items(), key=lambda item: item[0])
    ]


def _boss_definitions(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT boss_key, weekday, day_label, name, image_path, atk, def, spd, sort_order
        FROM boss_definitions
        WHERE is_active = TRUE
        ORDER BY sort_order
        """
    ).fetchall()
    return [
        {
            "key": row["boss_key"],
            "weekday": row["weekday"],
            "dayLabel": row["day_label"],
            "name": row["name"],
            "imagePath": row["image_path"],
            "atk": row["atk"],
            "def": row["def"],
            "spd": row["spd"],
            "sortOrder": row["sort_order"],
        }
        for row in rows
    ]


def _rules(connection, dsn: str) -> dict[str, Any]:
    rows = connection.execute("SELECT key, value FROM rule_settings").fetchall()
    stored = {row["key"]: row["value"] for row in rows}
    return stored or read_rules(dsn)


def _identity_links(connection) -> list[dict[str, Any]]:
    exists = connection.execute(
        "SELECT to_regclass('public.member_identity_links') AS table_name"
    ).fetchone()
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
