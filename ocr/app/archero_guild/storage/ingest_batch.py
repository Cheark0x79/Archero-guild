from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from archero_guild.import_capture import ImportedScreenshot, ImportReport
from archero_guild.pipeline.guild_boss import ExtractedBossRanking
from archero_guild.pipeline.guild_member_ocr import ExtractedMemberMetrics, RosterEntry
from archero_guild.storage.persistence import database_url_from_env, persist_import_report_in_connection


class BatchIngestionError(RuntimeError):
    pass


def ingest_batch(batch: dict[str, Any], dsn: str) -> dict[str, Any]:
    _validate_batch(batch)
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise BatchIngestionError("psycopg is required to ingest a remote batch") from exc

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            _ensure_remote_table(cursor)
            cursor.execute(
                """
                INSERT INTO remote_import_batches (
                    idempotency_key, schema_version, capture_date, agent_version,
                    status, payload
                )
                VALUES (%s, %s, %s, %s, 'received', %s::jsonb)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
                """,
                (
                    batch["idempotencyKey"],
                    batch["schemaVersion"],
                    batch["captureDate"],
                    batch["agentVersion"],
                    _json(batch),
                ),
            )
            inserted = cursor.fetchone()
            if inserted is None:
                cursor.execute(
                    "SELECT id, status, result FROM remote_import_batches WHERE idempotency_key = %s",
                    (batch["idempotencyKey"],),
                )
                existing = cursor.fetchone()
                connection.rollback()
                return {
                    "id": int(existing[0]),
                    "status": existing[1],
                    "replayed": True,
                    "result": existing[2] or {},
                }
            remote_batch_id = int(inserted[0])

        report, roster, metrics, boss_rankings = _convert_batch(batch)
        persist_import_report_in_connection(
            connection,
            report,
            roster=roster,
            extracted_metrics=metrics,
            daily_boss_rankings={batch["captureDate"]: boss_rankings},
        )
        if batch.get("guildStats"):
            _persist_guild_stats(connection, batch["captureDate"], batch["guildStats"])
        result = {
            "captureDate": batch["captureDate"],
            "members": len(metrics),
            "bossRankings": len(boss_rankings),
        }
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE remote_import_batches
                SET status = 'published', result = %s::jsonb, published_at = now()
                WHERE id = %s
                """,
                (_json(result), remote_batch_id),
            )
        connection.commit()
        return {"id": remote_batch_id, "status": "published", "replayed": False, "result": result}


def _ensure_remote_table(cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS remote_import_batches (
            id BIGSERIAL PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            schema_version INTEGER NOT NULL,
            capture_date DATE NOT NULL,
            agent_version TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('received', 'published', 'failed')),
            payload JSONB NOT NULL,
            result JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            published_at TIMESTAMPTZ
        )
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS remote_import_batches_capture_date_idx
        ON remote_import_batches (capture_date DESC, created_at DESC)
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS guild_stat_snapshots (
            capture_date DATE PRIMARY KEY,
            guild_name TEXT,
            guild_id TEXT,
            guild_level INTEGER,
            member_count INTEGER,
            member_capacity INTEGER,
            total_power BIGINT,
            donations_value BIGINT,
            guild_rank INTEGER,
            xp_current BIGINT,
            xp_required BIGINT,
            raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def _persist_guild_stats(connection, capture_date: str, stats: dict[str, Any]) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO guild_stat_snapshots (
                capture_date, guild_name, guild_id, guild_level, member_count,
                member_capacity, total_power, donations_value, guild_rank,
                xp_current, xp_required, raw_payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (capture_date) DO UPDATE SET
                guild_name = EXCLUDED.guild_name,
                guild_id = EXCLUDED.guild_id,
                guild_level = EXCLUDED.guild_level,
                member_count = EXCLUDED.member_count,
                member_capacity = EXCLUDED.member_capacity,
                total_power = EXCLUDED.total_power,
                donations_value = EXCLUDED.donations_value,
                guild_rank = EXCLUDED.guild_rank,
                xp_current = EXCLUDED.xp_current,
                xp_required = EXCLUDED.xp_required,
                raw_payload = EXCLUDED.raw_payload,
                updated_at = now()
            """,
            (
                capture_date, stats.get("guildName"), stats.get("guildId"), stats.get("level"),
                stats.get("memberCount"), stats.get("memberCapacity"), stats.get("totalPower"),
                stats.get("donationsValue"), stats.get("rank"), stats.get("xpCurrent"),
                stats.get("xpRequired"), _json(stats),
            ),
        )


def _convert_batch(
    batch: dict[str, Any],
) -> tuple[ImportReport, list[RosterEntry], list[ExtractedMemberMetrics], list[ExtractedBossRanking]]:
    images: list[ImportedScreenshot] = []
    for index, image in enumerate(batch["sourceImages"], start=1):
        source_name = image.get("sourceName") or f"{image['kind']}-{index:03d}.png"
        images.append(
            ImportedScreenshot(
                path=f"remote/{batch['captureDate']}/{source_name}",
                kind=image["kind"],
                row_count=image["detectedRows"],
                sha256=image["sha256"],
                source_width=image["width"],
                source_height=image["height"],
                analysis_width=1080,
                analysis_height=round(image["height"] * 1080 / image["width"]),
            )
        )
    members = [_member_metric(row) for row in batch["members"]]
    roster = [
        RosterEntry(player_id=row["playerId"], name=row["name"], power_hint=row.get("power"))
        for row in batch["members"]
        if row.get("playerId")
    ]
    bosses = [_boss_ranking(row, index) for index, row in enumerate(batch["bossRankings"])]
    report = ImportReport(
        date=batch["captureDate"],
        captured_at=batch["generatedAt"],
        raw_dir=f"remote:{batch['agentVersion']}",
        member_screenshots=[image for image in images if image.kind == "guild-members"],
        boss_screenshots=[image for image in images if image.kind == "guild-boss"],
        detected_member_rows=sum(image.row_count or 0 for image in images if image.kind == "guild-members"),
        detected_boss_rows=sum(image.row_count or 0 for image in images if image.kind == "guild-boss"),
        extracted_member_metrics=len(members),
        report_path=f"remote:{batch['idempotencyKey']}",
        front_updated=False,
        quality=batch["quality"],
        database_persisted=True,
    )
    return report, roster, members, bosses


def _member_metric(row: dict[str, Any]) -> ExtractedMemberMetrics:
    return ExtractedMemberMetrics(
        player_id=row.get("playerId") or "",
        name=row["name"],
        role=row.get("role"),
        power=row.get("power"),
        donation=row.get("contribution7d"),
        boss_tries=row.get("bossAttacks"),
        last_activity_days=row.get("lastActivityDays"),
        source=row["source"],
        match_score=float(row.get("matchScore") or 0),
        raw_name=row.get("rawName") or row["name"],
        power_text=row.get("powerText"),
        activity_text=row.get("activityText"),
        role_text=row.get("roleText"),
        raw_activity=row.get("rawActivity") or "",
        raw_role=row.get("rawRole") or "",
    )


def _boss_ranking(row: dict[str, Any], index: int) -> ExtractedBossRanking:
    return ExtractedBossRanking(
        source=row["source"],
        row_index=int(row.get("rowIndex", index)),
        area=row.get("area") or ("podium" if int(row["rank"]) <= 3 else "list"),
        boss_rank=int(row["rank"]),
        player_id=row.get("playerId"),
        name=row["name"],
        raw_name=row.get("rawName"),
        damage_text=row["damageText"],
        boss_damage_today=int(row["damage"]),
    )


def _validate_batch(batch: dict[str, Any]) -> None:
    required = {
        "schemaVersion",
        "captureDate",
        "generatedAt",
        "agentVersion",
        "idempotencyKey",
        "sourceImages",
        "members",
        "bossRankings",
        "quality",
    }
    missing = sorted(required - set(batch))
    if missing:
        raise BatchIngestionError(f"missing required fields: {', '.join(missing)}")
    if batch["schemaVersion"] != 1:
        raise BatchIngestionError("unsupported schemaVersion")
    quality = batch["quality"]
    source_kinds = {
        image.get("kind")
        for image in batch.get("sourceImages", [])
        if isinstance(image, dict)
    }
    if not source_kinds or not source_kinds.issubset({"guild-members", "guild-boss"}) or quality.get("coverage") != 1:
        raise BatchIngestionError("quality gate requires every capture scope with 100% coverage")
    if "guild-members" in source_kinds and not batch.get("members"):
        raise BatchIngestionError("quality gate requires at least one member row")
    boss_rows = batch.get("bossRankings") or []
    if "guild-boss" in source_kinds and (
        not boss_rows
        or any(
            not isinstance(row, dict)
            or not isinstance(row.get("rank"), int)
            or not str(row.get("name") or "").strip()
            or not isinstance(row.get("damage"), int)
            or not str(row.get("damageText") or "").strip()
            for row in boss_rows
        )
    ):
        raise BatchIngestionError("quality gate requires complete boss rows")
    if batch.get("guildStats") is not None:
        _validate_guild_stats(batch["guildStats"])


def _validate_guild_stats(stats: object) -> None:
    if not isinstance(stats, dict):
        raise BatchIngestionError("guildStats must be an object")
    for field in (
        "level", "memberCount", "memberCapacity", "totalPower", "donationsValue",
        "rank", "xpCurrent", "xpRequired",
    ):
        value = stats.get(field)
        if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
            raise BatchIngestionError(f"guildStats.{field} must be a non-negative integer or null")
    if stats.get("memberCount") is not None and stats.get("memberCapacity") is not None:
        if stats["memberCount"] > stats["memberCapacity"]:
            raise BatchIngestionError("guildStats.memberCount cannot exceed memberCapacity")


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Atomically ingest a validated OCR batch.")
    parser.add_argument("batch", type=Path)
    parser.add_argument("--dsn", default=database_url_from_env())
    args = parser.parse_args(argv)
    if not args.dsn:
        parser.error("ARCHERO_DATABASE_URL or --dsn is required")
    batch = json.loads(args.batch.read_text(encoding="utf-8"))
    print(json.dumps(ingest_batch(batch, args.dsn), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
