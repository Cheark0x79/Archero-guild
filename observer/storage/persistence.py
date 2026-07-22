from __future__ import annotations

import os
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from observer.import_capture import ImportReport
from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics, RosterEntry


def database_url_from_env() -> str | None:
    return os.environ.get("ARCHERO_DATABASE_URL") or os.environ.get("DATABASE_URL")


def persist_import_if_configured(
    report: ImportReport,
    *,
    roster: Sequence[RosterEntry],
    extracted_metrics: Sequence[ExtractedMemberMetrics],
    daily_boss_rankings: dict[str, list[ExtractedBossRanking]],
    dsn: str | None = None,
) -> bool:
    database_url = dsn or database_url_from_env()
    if not database_url:
        return False
    try:
        persist_import_report(database_url, report=report, roster=roster, extracted_metrics=extracted_metrics, daily_boss_rankings=daily_boss_rankings)
    except Exception as exc:
        if not _is_database_unavailable(exc):
            raise
        print(f"warning: database persistence skipped: {_database_error_message(exc)}", file=sys.stderr)
        return False
    return True


def persist_import_report(
    dsn: str,
    report: ImportReport,
    *,
    roster: Sequence[RosterEntry],
    extracted_metrics: Sequence[ExtractedMemberMetrics],
    daily_boss_rankings: dict[str, list[ExtractedBossRanking]],
) -> None:
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover - depends on local runtime
        raise RuntimeError("psycopg is required when ARCHERO_DATABASE_URL is configured") from exc

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            batch_id = _upsert_capture_batch(cursor, report)
            _upsert_roster(cursor, roster, report.captured_at)
            screenshots_by_path = _upsert_screenshots(cursor, batch_id, report)
            _upsert_import_report(cursor, batch_id, report)
            _replace_member_metrics(cursor, batch_id, report, extracted_metrics, screenshots_by_path)
            _replace_boss_results(cursor, report, daily_boss_rankings, screenshots_by_path)
        connection.commit()


def _upsert_capture_batch(cursor, report: ImportReport) -> int:
    cursor.execute(
        """
        SELECT batch_id
        FROM import_reports
        WHERE capture_date = %s AND report_path = %s AND batch_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (report.date, report.report_path),
    )
    existing = cursor.fetchone()
    if existing:
        batch_id = int(existing[0])
        cursor.execute(
            """
            UPDATE capture_batches
            SET captured_at = %s,
                imported_at = %s,
                source = 'manual',
                status = 'imported',
                notes = %s::jsonb
            WHERE id = %s
            """,
            (report.captured_at, report.captured_at, _json({"raw_dir": report.raw_dir}), batch_id),
        )
        return batch_id

    cursor.execute(
        """
        INSERT INTO capture_batches (capture_date, captured_at, imported_at, source, status, notes)
        VALUES (%s, %s, %s, 'manual', 'imported', %s::jsonb)
        RETURNING id
        """,
        (report.date, report.captured_at, report.captured_at, _json({"raw_dir": report.raw_dir})),
    )
    return int(cursor.fetchone()[0])


def _upsert_roster(cursor, roster: Sequence[RosterEntry], seen_at: str) -> None:
    for entry in roster:
        if not entry.player_id:
            continue
        cursor.execute(
            """
            INSERT INTO guild_members (user_id, current_name, first_seen_at, last_seen_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
                current_name = EXCLUDED.current_name,
                last_seen_at = EXCLUDED.last_seen_at,
                status = 'active'
            """,
            (entry.player_id, entry.name, seen_at, seen_at),
        )
        cursor.execute(
            """
            INSERT INTO member_names (user_id, name, first_seen_at, last_seen_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, name) DO UPDATE SET
                last_seen_at = EXCLUDED.last_seen_at
            """,
            (entry.player_id, entry.name, seen_at, seen_at),
        )


def _upsert_screenshots(cursor, batch_id: int, report: ImportReport) -> dict[str, int]:
    screenshots_by_path: dict[str, int] = {}
    for screenshot in [*report.member_screenshots, *report.boss_screenshots]:
        relative_path = _relative_project_path(screenshot.path)
        cursor.execute(
            """
            INSERT INTO screenshots (batch_id, capture_date, kind, relative_path, sequence_no, status, metadata)
            VALUES (%s, %s, %s, %s, %s, 'imported', %s::jsonb)
            ON CONFLICT (relative_path) DO UPDATE SET
                batch_id = EXCLUDED.batch_id,
                capture_date = EXCLUDED.capture_date,
                kind = EXCLUDED.kind,
                sequence_no = EXCLUDED.sequence_no,
                status = EXCLUDED.status,
                metadata = EXCLUDED.metadata
            RETURNING id
            """,
            (
                batch_id,
                report.date,
                screenshot.kind,
                relative_path,
                _sequence_from_path(relative_path),
                _json({"row_count": screenshot.row_count}),
            ),
        )
        screenshots_by_path[relative_path] = int(cursor.fetchone()[0])
    return screenshots_by_path


def _upsert_import_report(cursor, batch_id: int, report: ImportReport) -> None:
    cursor.execute(
        """
        INSERT INTO import_reports (capture_date, batch_id, report_path, report_payload, front_updated)
        VALUES (%s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (capture_date, report_path) DO UPDATE SET
            batch_id = EXCLUDED.batch_id,
            report_payload = EXCLUDED.report_payload,
            front_updated = EXCLUDED.front_updated,
            created_at = now()
        """,
        (report.date, batch_id, report.report_path, _json(asdict(report)), report.front_updated),
    )


def _replace_member_metrics(
    cursor,
    batch_id: int,
    report: ImportReport,
    extracted_metrics: Sequence[ExtractedMemberMetrics],
    screenshots_by_path: dict[str, int],
) -> None:
    cursor.execute("DELETE FROM guild_snapshots WHERE capture_date = %s", (report.date,))
    if not extracted_metrics:
        return

    screenshot_id = next(iter(screenshots_by_path.values()), None)
    cursor.execute(
        """
        INSERT INTO guild_snapshots (batch_id, capture_date, captured_at, source, screenshot_id)
        VALUES (%s, %s, %s, 'import', %s)
        RETURNING id
        """,
        (batch_id, report.date, report.captured_at, screenshot_id),
    )
    snapshot_id = int(cursor.fetchone()[0])
    for metric in extracted_metrics:
        cursor.execute(
            """
            INSERT INTO member_metrics (
                snapshot_id, user_id, role, power, contribution_7d, boss_attacks,
                last_activity_days, verification_note, raw_payload
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                snapshot_id,
                metric.player_id,
                metric.role,
                metric.power,
                metric.donation,
                metric.boss_tries,
                metric.last_activity_days,
                metric.source,
                _json(asdict(metric)),
            ),
        )


def _replace_boss_results(
    cursor,
    report: ImportReport,
    daily_boss_rankings: dict[str, list[ExtractedBossRanking]],
    screenshots_by_path: dict[str, int],
) -> None:
    for day, rankings in daily_boss_rankings.items():
        boss_key = _boss_key_for_date(day)
        cursor.execute("DELETE FROM boss_daily_results WHERE capture_date = %s", (day,))
        for index, ranking in enumerate(_dedupe_boss_rankings(rankings)):
            if not ranking.name and not ranking.player_id:
                continue
            screenshot_id = _screenshot_id_for_source(screenshots_by_path, ranking.source)
            cursor.execute(
                """
                INSERT INTO boss_daily_results (
                    capture_date, boss_key, user_id, player_name, raw_name, boss_rank,
                    damage_text, damage_value, screenshot_id, row_source, row_area, row_index, raw_payload
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    day,
                    boss_key,
                    ranking.player_id,
                    ranking.name or ranking.raw_name or "Unknown",
                    ranking.raw_name,
                    ranking.boss_rank,
                    ranking.damage_text,
                    ranking.boss_damage_today,
                    screenshot_id,
                    ranking.source,
                    ranking.area,
                    ranking.row_index if ranking.row_index is not None else index,
                    _json(asdict(ranking)),
                ),
            )


def _dedupe_boss_rankings(rankings: Sequence[ExtractedBossRanking]) -> list[ExtractedBossRanking]:
    unique_rankings: list[ExtractedBossRanking] = []
    rank_positions: dict[int, int] = {}
    for ranking in rankings:
        if ranking.boss_rank is None:
            unique_rankings.append(ranking)
            continue

        existing_index = rank_positions.get(ranking.boss_rank)
        if existing_index is None:
            rank_positions[ranking.boss_rank] = len(unique_rankings)
            unique_rankings.append(ranking)
            continue

        if _boss_ranking_quality(ranking) > _boss_ranking_quality(unique_rankings[existing_index]):
            unique_rankings[existing_index] = ranking
    return unique_rankings


def _boss_ranking_quality(ranking: ExtractedBossRanking) -> tuple[int, int, int, int]:
    return (
        1 if ranking.player_id else 0,
        1 if ranking.name else 0,
        1 if ranking.boss_damage_today is not None else 0,
        len(ranking.raw_name or ""),
    )


def _boss_key_for_date(date: str) -> str:
    from datetime import date as date_type

    weekday = date_type.fromisoformat(date).weekday()
    return [
        "treant-guardian",
        "fire-dragon",
        "flame-demon",
        "medusa",
        "stoneman",
        "cyclops-mage",
        "grim-reaper",
    ][weekday]


def _screenshot_id_for_source(screenshots_by_path: dict[str, int], source: str | None) -> int | None:
    if not source:
        return None
    file_name = source.split(" ")[0]
    for path, screenshot_id in screenshots_by_path.items():
        if path.endswith(file_name):
            return screenshot_id
    return None


def _relative_project_path(value: str) -> str:
    path = Path(value)
    parts = path.parts
    if "screenshots" in parts:
        return "/".join(parts[parts.index("screenshots") :])
    return value.replace("\\", "/")


def _sequence_from_path(value: str) -> int:
    match = __import__("re").search(r"-(\d{3})\.png$", value)
    return int(match.group(1)) if match else 1


def _json(value: object) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


def _is_database_unavailable(exc: Exception) -> bool:
    try:
        import psycopg
    except ImportError:
        return False

    return isinstance(exc, psycopg.OperationalError)


def _database_error_message(exc: Exception) -> str:
    message = str(exc).strip().splitlines()[0] if str(exc).strip() else exc.__class__.__name__
    return message[:240]
