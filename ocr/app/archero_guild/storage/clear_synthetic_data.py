from __future__ import annotations

import argparse
import json
from typing import Any

from archero_guild.storage.persistence import database_url_from_env


class SyntheticDataClearError(RuntimeError):
    pass


SAFETY_CHECKS = (
    (
        "guild members",
        """
        SELECT count(*) FROM guild_members
        WHERE user_id !~ '^9000000[0-9]{2}$' OR current_name NOT LIKE 'Demo%'
        """,
    ),
    (
        "remote import batches",
        """
        SELECT count(*) FROM remote_import_batches
        WHERE agent_version NOT LIKE 'synthetic-web-admin-v1-%'
           OR idempotency_key NOT LIKE 'synthetic-web-admin-v1:%'
        """,
    ),
    (
        "capture batches",
        """
        SELECT count(*) FROM capture_batches
        WHERE COALESCE(notes->>'raw_dir', '') NOT LIKE 'remote:synthetic-web-admin-v1-%'
        """,
    ),
    (
        "screenshots",
        "SELECT count(*) FROM screenshots WHERE relative_path NOT LIKE 'remote/%/synthetic-%'",
    ),
    (
        "import reports",
        "SELECT count(*) FROM import_reports WHERE report_path NOT LIKE 'remote:synthetic-web-admin-v1:%'",
    ),
    (
        "member snapshots",
        """
        SELECT count(*) FROM guild_snapshots
        WHERE batch_id IS NULL OR batch_id NOT IN (SELECT id FROM capture_batches)
        """,
    ),
    (
        "member metrics",
        "SELECT count(*) FROM member_metrics WHERE verification_note NOT LIKE 'synthetic/members-%'",
    ),
    (
        "unmatched member metrics",
        "SELECT count(*) FROM unmatched_member_metrics WHERE verification_note NOT LIKE 'synthetic/members-%'",
    ),
    (
        "boss results",
        "SELECT count(*) FROM boss_daily_results WHERE row_source NOT LIKE 'synthetic/%'",
    ),
    (
        "member identity links",
        "SELECT count(*) FROM member_identity_links WHERE user_id !~ '^9000000[0-9]{2}$'",
    ),
    (
        "member name history",
        "SELECT count(*) FROM member_names WHERE user_id !~ '^9000000[0-9]{2}$'",
    ),
)


def clear_synthetic_data(dsn: str) -> dict[str, int]:
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover - runtime image provides it
        raise SyntheticDataClearError("psycopg is required to clear synthetic data") from exc

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            violations = []
            for label, query in SAFETY_CHECKS:
                cursor.execute(query)
                count = int(cursor.fetchone()[0])
                if count:
                    violations.append(f"{label}: {count} non-synthetic row(s)")
            if violations:
                raise SyntheticDataClearError(
                    "refusing to clear a database that is not exclusively synthetic: " + "; ".join(violations)
                )

            counts = {}
            for key, table in (
                ("members", "guild_members"),
                ("days", "guild_snapshots"),
                ("bossResults", "boss_daily_results"),
                ("importBatches", "remote_import_batches"),
            ):
                cursor.execute(f"SELECT count(*) FROM {table}")
                counts[key] = int(cursor.fetchone()[0])

            for table in (
                "remote_import_batches",
                "boss_daily_results",
                "unmatched_member_metrics",
                "member_metrics",
                "guild_snapshots",
                "import_reports",
                "screenshots",
                "capture_batches",
                "member_identity_links",
                "member_names",
                "guild_members",
            ):
                cursor.execute(f"DELETE FROM {table}")
        connection.commit()
        return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Clear an exclusively synthetic isolated database.")
    parser.add_argument("--dsn", default=database_url_from_env())
    args = parser.parse_args(argv)
    if not args.dsn:
        parser.error("ARCHERO_DATABASE_URL or --dsn is required")
    try:
        result: dict[str, Any] = clear_synthetic_data(args.dsn)
    except SyntheticDataClearError as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
