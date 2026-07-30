from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from observer.import_capture import ImportedScreenshot, ImportReport
from observer.pipeline.guild_boss import ExtractedBossRanking
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics, RosterEntry
from observer.storage.persistence import database_url_from_env, persist_import_report_in_connection


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
    if len(source_kinds) != 1 or quality.get("coverage") != 1:
        raise BatchIngestionError("quality gate requires one capture scope with 100% coverage")
    if source_kinds == {"guild-members"} and not batch.get("members"):
        raise BatchIngestionError("quality gate requires at least one member row")
    if source_kinds == {"guild-boss"} and (
        not batch.get("bossRankings") or quality.get("completeness") != 1
    ):
        raise BatchIngestionError("quality gate requires complete boss rows")


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
