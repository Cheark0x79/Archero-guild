from __future__ import annotations

import argparse
import json
from typing import Any

from observer.storage.persistence import database_url_from_env


class ImportHistoryError(RuntimeError):
    pass


def read_import_history(dsn: str, *, limit: int = 10) -> list[dict[str, Any]]:
    if not 1 <= limit <= 50:
        raise ImportHistoryError("limit must be between 1 and 50")
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover
        raise ImportHistoryError("psycopg is required to read import history") from exc

    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, capture_date, agent_version, status, result,
                       created_at, published_at
                FROM remote_import_batches
                ORDER BY created_at DESC, id DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cursor.fetchall()
    return [_public_record(row) for row in rows]


def _public_record(row: dict[str, Any]) -> dict[str, Any]:
    result = row.get("result") if isinstance(row.get("result"), dict) else {}
    return {
        "id": int(row["id"]),
        "captureDate": row["capture_date"].isoformat(),
        "agentVersion": str(row["agent_version"]),
        "status": str(row["status"]),
        "members": int(result.get("members") or 0),
        "bossRankings": int(result.get("bossRankings") or 0),
        "createdAt": row["created_at"].isoformat(),
        "publishedAt": row["published_at"].isoformat() if row.get("published_at") else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read sanitized remote OCR import history.")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--dsn", default=database_url_from_env())
    args = parser.parse_args(argv)
    if not args.dsn:
        parser.error("ARCHERO_DATABASE_URL or --dsn is required")
    print(json.dumps(read_import_history(args.dsn, limit=args.limit), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
