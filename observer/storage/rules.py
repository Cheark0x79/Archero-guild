from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from observer.storage.persistence import database_url_from_env

RULE_LIMITS = {
    "maxInactiveDays": (0, 365),
    "minContribution7d": (0, 1_000_000),
    "minPowerGrowth14dPercent": (0, 1_000),
    "minBossTries": (0, 100),
    "newMemberGraceDays": (0, 365),
    "memberCapacity": (1, 1_000),
}


def read_rules(dsn: str) -> dict[str, Any]:
    stored_rules = _read_database_rules(dsn)
    if stored_rules:
        try:
            return _normalize_rules(stored_rules)
        except ValueError:
            pass
    legacy_rules = _read_legacy_rules()
    if legacy_rules:
        return write_rules(dsn, {**legacy_rules, **stored_rules})
    return stored_rules


def _read_database_rules(dsn: str) -> dict[str, Any]:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - depends on local runtime
        raise RuntimeError("psycopg is required to manage rules in PostgreSQL") from exc

    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        rows = connection.execute("SELECT key, value FROM rule_settings ORDER BY key").fetchall()
    return {row["key"]: row["value"] for row in rows}


def write_rules(dsn: str, rules: dict[str, Any]) -> dict[str, Any]:
    rules = _normalize_rules(rules)
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover - depends on local runtime
        raise RuntimeError("psycopg is required to manage rules in PostgreSQL") from exc

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            for key, value in rules.items():
                cursor.execute(
                    """
                    INSERT INTO rule_settings (key, value, updated_at)
                    VALUES (%s, %s::jsonb, now())
                    ON CONFLICT (key) DO UPDATE SET
                        value = EXCLUDED.value,
                        updated_at = now()
                    """,
                    (key, json.dumps(value)),
                )
        connection.commit()
    return _read_database_rules(dsn)


def _read_legacy_rules() -> dict[str, Any]:
    configured_path = os.environ.get("ARCHERO_RULES_FILE")
    path = Path(configured_path) if configured_path else Path.cwd() / "data" / "rules.json"
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    try:
        return _normalize_rules(parsed)
    except ValueError:
        return {}


def _normalize_rules(value: dict[str, Any]) -> dict[str, int | float]:
    normalized: dict[str, int | float] = {}
    for key, (minimum, maximum) in RULE_LIMITS.items():
        candidate = value.get(key)
        if isinstance(candidate, bool) or not isinstance(candidate, (int, float)):
            raise ValueError(f"{key} must be numeric")
        if candidate < minimum or candidate > maximum:
            raise ValueError(f"{key} must be between {minimum} and {maximum}")
        normalized[key] = candidate
    return normalized


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read or update Archero guild rules in PostgreSQL.")
    parser.add_argument("--dsn", default=database_url_from_env())
    parser.add_argument("--set-json")
    args = parser.parse_args(argv)
    if not args.dsn:
        raise SystemExit("ARCHERO_DATABASE_URL or DATABASE_URL is required")

    if args.set_json is None:
        rules = read_rules(args.dsn)
    else:
        parsed = json.loads(args.set_json)
        if not isinstance(parsed, dict):
            raise SystemExit("--set-json must contain a JSON object")
        rules = write_rules(args.dsn, parsed)
    print(json.dumps({"rules": rules}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
