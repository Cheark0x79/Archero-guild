from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Sequence

from observer.import_capture import ImportReport
from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics
from observer.storage.persistence import (
    _reconcile_active_roster,
    database_url_from_env,
    persist_import_report_in_connection,
)


PRESERVED_DATES = (
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-18",
    "2026-07-19",
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-25",
)
EXPECTED_SOURCE_SHA256 = "fa967d8be179125a8f69e424f8f0c65daab21bb8da4c5ad87329a2cd18885fd1"
EXPECTED_MEMBER_DATES = PRESERVED_DATES
EXPECTED_BOSS_DATES = PRESERVED_DATES[1:]
CONFIRMATION = "IMPORT LEGACY HISTORY"


class LegacyHistoryError(RuntimeError):
    pass


@dataclass(frozen=True)
class LegacyExpectations:
    source_sha256: str
    member_dates: tuple[str, ...]
    boss_dates: tuple[str, ...]
    roster_rows: int
    roster_with_id: int
    member_rows: int
    boss_rows: int


@dataclass(frozen=True)
class LegacySummary:
    source_sha256: str
    preserved_dates: list[str]
    roster_rows: int
    roster_with_id: int
    member_days: int
    member_rows: int
    boss_days: int
    boss_rows: int


DEFAULT_EXPECTATIONS = LegacyExpectations(
    source_sha256=EXPECTED_SOURCE_SHA256,
    member_dates=EXPECTED_MEMBER_DATES,
    boss_dates=EXPECTED_BOSS_DATES,
    roster_rows=40,
    roster_with_id=38,
    member_rows=364,
    boss_rows=297,
)


def load_legacy_payload(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LegacyHistoryError(f"{path} is not a valid legacy history payload") from exc
    if not isinstance(payload, dict):
        raise LegacyHistoryError("legacy history payload must be a JSON object")
    return payload


def validate_legacy_payload(
    payload: dict[str, Any],
    expectations: LegacyExpectations = DEFAULT_EXPECTATIONS,
) -> LegacySummary:
    if payload.get("schemaVersion") != 1 or payload.get("kind") != "archero-legacy-history":
        raise LegacyHistoryError("unsupported legacy history payload")
    if payload.get("sourceSha256") != expectations.source_sha256:
        raise LegacyHistoryError("legacy source checksum does not match the approved production file")
    preserved_dates = payload.get("preservedDates")
    if preserved_dates != list(expectations.member_dates):
        raise LegacyHistoryError("preserved date whitelist does not match the approved production dates")
    roster = _list(payload, "guildRoster")
    member_days = _list(payload, "dailyRawSnapshots")
    boss_days = _list(payload, "dailyBossRawSnapshots")
    member_dates = tuple(_day_date(day, "dailyRawSnapshots") for day in member_days)
    boss_dates = tuple(_day_date(day, "dailyBossRawSnapshots") for day in boss_days)
    if member_dates != expectations.member_dates:
        raise LegacyHistoryError("member history dates do not match the approved production dates")
    if boss_dates != expectations.boss_dates:
        raise LegacyHistoryError("boss history dates do not match the approved production dates")
    roster_with_id = sum(
        1 for row in roster
        if isinstance(row, dict) and str(row.get("playerId") or "").strip()
    )
    member_rows = sum(len(_rows(day)) for day in member_days)
    boss_rows = sum(len(_rows(day)) for day in boss_days)
    actual = (len(roster), roster_with_id, member_rows, boss_rows)
    expected = (
        expectations.roster_rows,
        expectations.roster_with_id,
        expectations.member_rows,
        expectations.boss_rows,
    )
    if actual != expected:
        raise LegacyHistoryError(
            "legacy history totals do not match the approved production data: "
            f"expected {expected}, received {actual}"
        )
    return LegacySummary(
        source_sha256=payload["sourceSha256"],
        preserved_dates=list(preserved_dates),
        roster_rows=len(roster),
        roster_with_id=roster_with_id,
        member_days=len(member_days),
        member_rows=member_rows,
        boss_days=len(boss_days),
        boss_rows=boss_rows,
    )


def migrate_legacy_history(payload: dict[str, Any], dsn: str) -> dict[str, Any]:
    summary = validate_legacy_payload(payload)
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise LegacyHistoryError("psycopg is required to import legacy history") from exc

    with psycopg.connect(dsn) as connection:
        _verify_schema(connection)
        _refuse_unmanaged_history(connection, payload)
        _upsert_legacy_roster(connection, payload)
        roster_names = {
            str(row["playerId"]): str(row["name"])
            for row in payload["guildRoster"]
            if isinstance(row, dict) and row.get("playerId") and row.get("name")
        }
        members_by_date = {day["date"]: day["rows"] for day in payload["dailyRawSnapshots"]}
        bosses_by_date = {day["date"]: day["rows"] for day in payload["dailyBossRawSnapshots"]}
        for capture_date in PRESERVED_DATES:
            members = [_member_metric(row, roster_names) for row in members_by_date.get(capture_date, [])]
            bosses = [_boss_ranking(row, index) for index, row in enumerate(bosses_by_date.get(capture_date, []))]
            report = _legacy_report(capture_date, members, bosses)
            persist_import_report_in_connection(
                connection,
                report,
                roster=[],
                extracted_metrics=members,
                daily_boss_rankings={capture_date: bosses} if bosses else {},
            )
        _reconcile_against_newer_snapshot(connection)
        _verify_imported_totals(connection, summary)
        connection.commit()
    return {"status": "imported", **asdict(summary)}


def _verify_schema(connection) -> None:
    required = ("guild_members", "guild_snapshots", "member_metrics", "boss_daily_results")
    with connection.cursor() as cursor:
        for table in required:
            cursor.execute("SELECT to_regclass(%s)", (f"public.{table}",))
            if cursor.fetchone()[0] is None:
                raise LegacyHistoryError(f"database schema is missing public.{table}")


def _refuse_unmanaged_history(connection, payload: dict[str, Any]) -> None:
    with connection.cursor() as cursor:
        for capture_date in PRESERVED_DATES:
            marker = f"legacy-production:{capture_date}"
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM import_reports WHERE capture_date = %s AND report_path = %s)",
                (capture_date, marker),
            )
            managed = bool(cursor.fetchone()[0])
            cursor.execute(
                """
                SELECT
                    (SELECT count(*) FROM guild_snapshots WHERE capture_date = %s),
                    (SELECT count(*) FROM boss_daily_results WHERE capture_date = %s)
                """,
                (capture_date, capture_date),
            )
            member_snapshots, boss_rows = (int(value) for value in cursor.fetchone())
            if (member_snapshots or boss_rows) and not managed:
                raise LegacyHistoryError(
                    f"{capture_date} already contains unmanaged database history; refusing to replace it"
                )


def _upsert_legacy_roster(connection, payload: dict[str, Any]) -> None:
    seen_dates: dict[str, list[str]] = {}
    for key in ("dailyRawSnapshots", "dailyBossRawSnapshots"):
        for day in payload[key]:
            for row in day["rows"]:
                player_id = str(row.get("playerId") or "").strip()
                if player_id:
                    seen_dates.setdefault(player_id, []).append(day["date"])
    with connection.cursor() as cursor:
        for row in payload["guildRoster"]:
            if not isinstance(row, dict):
                continue
            player_id = str(row.get("playerId") or "").strip()
            name = str(row.get("name") or "").strip()
            if not player_id or not name:
                continue
            dates = seen_dates.get(player_id) or [PRESERVED_DATES[-1]]
            first_seen = f"{min(dates)}T12:00:00+02:00"
            last_seen = f"{max(dates)}T12:00:00+02:00"
            status = str(row.get("status") or "active")
            if status not in {"active", "kicked", "left", "unknown"}:
                status = "unknown"
            cursor.execute(
                """
                INSERT INTO guild_members (
                    user_id, current_name, discord_name, discord_linked, status,
                    left_on, first_seen_at, last_seen_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    first_seen_at = LEAST(guild_members.first_seen_at, EXCLUDED.first_seen_at),
                    discord_name = COALESCE(guild_members.discord_name, EXCLUDED.discord_name),
                    discord_linked = guild_members.discord_linked OR EXCLUDED.discord_linked,
                    current_name = CASE
                        WHEN guild_members.last_seen_at <= EXCLUDED.last_seen_at THEN EXCLUDED.current_name
                        ELSE guild_members.current_name
                    END,
                    status = CASE
                        WHEN guild_members.last_seen_at <= EXCLUDED.last_seen_at THEN EXCLUDED.status
                        ELSE guild_members.status
                    END,
                    left_on = CASE
                        WHEN guild_members.last_seen_at <= EXCLUDED.last_seen_at THEN EXCLUDED.left_on
                        ELSE guild_members.left_on
                    END,
                    last_seen_at = GREATEST(guild_members.last_seen_at, EXCLUDED.last_seen_at)
                """,
                (
                    player_id,
                    name,
                    row.get("discordName"),
                    bool(row.get("discordLinked")),
                    status,
                    row.get("leftAt"),
                    first_seen,
                    last_seen,
                ),
            )
            cursor.execute(
                """
                INSERT INTO member_names (user_id, name, first_seen_at, last_seen_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id, name) DO UPDATE SET
                    first_seen_at = LEAST(member_names.first_seen_at, EXCLUDED.first_seen_at),
                    last_seen_at = GREATEST(member_names.last_seen_at, EXCLUDED.last_seen_at)
                """,
                (player_id, name, first_seen, last_seen),
            )


def _reconcile_against_newer_snapshot(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, capture_date, captured_at
            FROM guild_snapshots
            WHERE capture_date > %s
            ORDER BY capture_date DESC, captured_at DESC
            LIMIT 1
            """,
            (PRESERVED_DATES[-1],),
        )
        latest = cursor.fetchone()
        if latest is None:
            return
        snapshot_id, _capture_date, captured_at = latest
        cursor.execute(
            """
            SELECT
                array_agg(user_id ORDER BY user_id),
                (
                    SELECT count(*)
                    FROM unmatched_member_metrics
                    WHERE snapshot_id = %s
                )
            FROM member_metrics
            WHERE snapshot_id = %s
            """,
            (snapshot_id, snapshot_id),
        )
        active_user_ids, unmatched_rows = cursor.fetchone()
        if not active_user_ids or int(unmatched_rows):
            return
        _reconcile_active_roster(cursor, list(active_user_ids), str(captured_at))


def _legacy_report(
    capture_date: str,
    members: list[ExtractedMemberMetrics],
    bosses: list[ExtractedBossRanking],
) -> ImportReport:
    return ImportReport(
        date=capture_date,
        captured_at=f"{capture_date}T12:00:00+02:00",
        raw_dir="legacy-production:embedded-history",
        member_screenshots=[],
        boss_screenshots=[],
        detected_member_rows=len(members),
        detected_boss_rows=len(bosses),
        extracted_member_metrics=len(members),
        report_path=f"legacy-production:{capture_date}",
        front_updated=True,
        quality={
            "status": "legacy-preserved",
            "sourceSha256": EXPECTED_SOURCE_SHA256,
        },
        database_persisted=True,
    )


def _member_metric(row: dict[str, Any], roster_names: dict[str, str]) -> ExtractedMemberMetrics:
    player_id = str(row.get("playerId") or "").strip()
    name = str(row.get("name") or roster_names.get(player_id) or row.get("rawName") or player_id).strip()
    return ExtractedMemberMetrics(
        player_id=player_id,
        name=name,
        role=row.get("role"),
        power=_optional_int(row.get("power")),
        donation=_optional_int(row.get("contribution7d")),
        boss_tries=_optional_int(row.get("bossAttacks")),
        last_activity_days=_optional_int(row.get("lastActivityDays")),
        source=str(row.get("verificationNote") or "legacy production history"),
        match_score=1.0 if player_id else 0.0,
        raw_name=str(row.get("rawName") or name),
    )


def _boss_ranking(row: dict[str, Any], index: int) -> ExtractedBossRanking:
    return ExtractedBossRanking(
        source=str(row.get("source") or "legacy production history"),
        row_index=int(row.get("rowIndex", index)),
        area=str(row.get("area") or ("podium" if int(row["bossRank"]) <= 3 else "list")),
        boss_rank=int(row["bossRank"]),
        player_id=str(row["playerId"]) if row.get("playerId") else None,
        name=str(row.get("name") or row.get("rawName") or "Unknown"),
        raw_name=str(row["rawName"]) if row.get("rawName") is not None else None,
        damage_text=str(row["damageText"]),
        boss_damage_today=int(row["bossDamageToday"]),
    )


def _verify_imported_totals(connection, summary: LegacySummary) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                (SELECT count(DISTINCT capture_date) FROM guild_snapshots WHERE capture_date = ANY(%s)),
                (
                    SELECT count(*)
                    FROM member_metrics metrics
                    JOIN guild_snapshots snapshots ON snapshots.id = metrics.snapshot_id
                    WHERE snapshots.capture_date = ANY(%s)
                )
                + (
                    SELECT count(*)
                    FROM unmatched_member_metrics metrics
                    JOIN guild_snapshots snapshots ON snapshots.id = metrics.snapshot_id
                    WHERE snapshots.capture_date = ANY(%s)
                ),
                (SELECT count(DISTINCT capture_date) FROM boss_daily_results WHERE capture_date = ANY(%s)),
                (SELECT count(*) FROM boss_daily_results WHERE capture_date = ANY(%s))
            """,
            (
                list(PRESERVED_DATES),
                list(PRESERVED_DATES),
                list(PRESERVED_DATES),
                list(PRESERVED_DATES),
                list(PRESERVED_DATES),
            ),
        )
        actual = tuple(int(value) for value in cursor.fetchone())
    expected = (summary.member_days, summary.member_rows, summary.boss_days, summary.boss_rows)
    if actual != expected:
        raise LegacyHistoryError(
            f"database verification failed: expected {expected}, received {actual}"
        )


def _list(payload: dict[str, Any], key: str) -> list[Any]:
    value = payload.get(key)
    if not isinstance(value, list):
        raise LegacyHistoryError(f"{key} must be an array")
    return value


def _rows(day: Any) -> list[dict[str, Any]]:
    if not isinstance(day, dict) or not isinstance(day.get("rows"), list):
        raise LegacyHistoryError("every legacy day must contain a rows array")
    return day["rows"]


def _day_date(day: Any, label: str) -> str:
    if not isinstance(day, dict) or not isinstance(day.get("date"), str):
        raise LegacyHistoryError(f"every {label} entry must contain a date")
    _rows(day)
    return day["date"]


def _optional_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Import the checksum-pinned legacy production history into PostgreSQL."
    )
    parser.add_argument("payload", type=Path)
    parser.add_argument("--dsn", default=database_url_from_env())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--confirm")
    args = parser.parse_args(argv)
    try:
        payload = load_legacy_payload(args.payload)
        summary = validate_legacy_payload(payload)
        if args.dry_run:
            result = {"status": "validated", **asdict(summary)}
        else:
            if args.confirm != CONFIRMATION:
                raise LegacyHistoryError(f'type --confirm "{CONFIRMATION}" to import legacy history')
            if not args.dsn:
                raise LegacyHistoryError("ARCHERO_DATABASE_URL, DATABASE_URL, or --dsn is required")
            result = migrate_legacy_history(payload, args.dsn)
    except LegacyHistoryError as exc:
        parser.exit(1, f"error: {exc}\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
