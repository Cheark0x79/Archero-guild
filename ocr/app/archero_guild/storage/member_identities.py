from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

from archero_guild.storage.export_json import database_url_from_env


_PLAYER_ID_PATTERN = re.compile(r"^\d{6,20}$")
_MEMBER_STATUSES = {"active", "left", "kicked"}
_DEPARTURE_REVIEW_DECISIONS = {"confirm", "restore"}
_GUILD_MEMBER_IDENTITY_UPSERT = """
    INSERT INTO guild_members (user_id, current_name, status)
    VALUES (%s, %s, 'active')
    ON CONFLICT (user_id) DO UPDATE SET
        status = 'active',
        last_seen_at = now()
"""


def normalize_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().casefold().split())


def list_identity_links(*, data_path: Path = Path("data/member-identities.json")) -> list[dict[str, Any]]:
    dsn = database_url_from_env()
    if dsn:
        return _list_database_links(dsn)
    return _read_local_links(data_path)


def assign_identity(
    observed_name: str,
    player_id: str,
    *,
    data_path: Path = Path("data/member-identities.json"),
) -> dict[str, Any]:
    name = " ".join(observed_name.strip().split())
    if not name:
        raise ValueError("observed name is required")
    if len(name) > 120:
        raise ValueError("observed name is too long")
    if not _PLAYER_ID_PATTERN.fullmatch(player_id):
        raise ValueError("player ID must contain 6 to 20 digits")

    link = {
        "normalizedName": normalize_name(name),
        "observedName": name,
        "playerId": player_id,
    }
    dsn = database_url_from_env()
    if dsn:
        _assign_database_link(dsn, link)
    else:
        _assign_local_link(data_path, link)
    return link


def edit_member_identity(
    current_player_id: str,
    player_id: str,
    observed_name: str,
    *,
    data_path: Path = Path("data/member-identities.json"),
) -> dict[str, str]:
    name = " ".join(observed_name.strip().split())
    if not _PLAYER_ID_PATTERN.fullmatch(current_player_id):
        raise ValueError("current player ID must contain 6 to 20 digits")
    if not _PLAYER_ID_PATTERN.fullmatch(player_id):
        raise ValueError("player ID must contain 6 to 20 digits")
    if not name or len(name) > 120:
        raise ValueError("observed name is required and must be at most 120 characters")

    dsn = database_url_from_env()
    if dsn:
        _edit_database_identity(dsn, current_player_id, player_id, name)
    else:
        _edit_local_identity(data_path, current_player_id, player_id, name)
    return {"previousPlayerId": current_player_id, "playerId": player_id, "observedName": name}


def set_member_status(
    player_id: str,
    status: str,
    *,
    observed_name: str = "",
    data_path: Path = Path("data/member-identities.json"),
) -> dict[str, Any]:
    if not _PLAYER_ID_PATTERN.fullmatch(player_id):
        raise ValueError("player ID must contain 6 to 20 digits")
    if status not in _MEMBER_STATUSES:
        raise ValueError("status must be active, left, or kicked")

    dsn = database_url_from_env()
    if dsn:
        _set_database_status(dsn, player_id, status)
    else:
        _set_local_status(data_path, player_id, status, observed_name)
    return {"playerId": player_id, "status": status}


def review_member_departure(
    player_id: str,
    decision: str,
    *,
    observed_name: str = "",
    data_path: Path = Path("data/member-identities.json"),
) -> dict[str, Any]:
    if not _PLAYER_ID_PATTERN.fullmatch(player_id):
        raise ValueError("player ID must contain 6 to 20 digits")
    if decision not in _DEPARTURE_REVIEW_DECISIONS:
        raise ValueError("decision must be confirm or restore")

    dsn = database_url_from_env()
    if dsn:
        _review_database_departure(dsn, player_id, decision)
    else:
        _review_local_departure(data_path, player_id, decision, observed_name)
    return {
        "playerId": player_id,
        "status": "active" if decision == "restore" else "left",
        "departureReview": None if decision == "restore" else {"status": "confirmed"},
    }


def rename_unmatched_member(capture_date: str, source: str, observed_name: str) -> dict[str, str]:
    try:
        from datetime import date

        date.fromisoformat(capture_date)
    except ValueError as exc:
        raise ValueError("capture date must use YYYY-MM-DD") from exc
    clean_source = " ".join(source.strip().split())
    clean_name = " ".join(observed_name.strip().split())
    if not clean_source or len(clean_source) > 240:
        raise ValueError("source is required")
    if not clean_name or len(clean_name) > 120:
        raise ValueError("observed name is required")

    dsn = database_url_from_env()
    if not dsn:
        raise ValueError("manual OCR name correction requires PostgreSQL")

    import psycopg
    from psycopg.types.json import Jsonb

    with psycopg.connect(dsn) as connection:
        with connection.transaction():
            rows = connection.execute(
                """
                SELECT u.id, u.raw_payload
                FROM unmatched_member_metrics u
                JOIN guild_snapshots gs ON gs.id = u.snapshot_id
                WHERE gs.capture_date = %s
                  AND trim(u.verification_note) = %s
                """,
                (capture_date, clean_source),
            ).fetchall()
            if len(rows) != 1:
                raise ValueError(
                    f"expected one unmatched member for {capture_date} / {clean_source}, found {len(rows)}"
                )
            row_id, raw_payload = rows[0]
            payload = raw_payload if isinstance(raw_payload, dict) else {}
            payload = {**payload, "name": clean_name}
            connection.execute(
                """
                UPDATE unmatched_member_metrics
                SET observed_name = %s,
                    normalized_name = %s,
                    raw_payload = %s
                WHERE id = %s
                """,
                (clean_name, normalize_name(clean_name), Jsonb(payload), row_id),
            )
    return {"captureDate": capture_date, "source": clean_source, "observedName": clean_name}


def _list_database_links(dsn: str) -> list[dict[str, Any]]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        _ensure_database_table(connection)
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


def _assign_database_link(dsn: str, link: dict[str, str]) -> None:
    import psycopg

    with psycopg.connect(dsn) as connection:
        _ensure_database_table(connection)
        with connection.transaction():
            connection.execute(_GUILD_MEMBER_IDENTITY_UPSERT, (link["playerId"], link["observedName"]))
            connection.execute(
                """
                INSERT INTO member_names (user_id, name, first_seen_at, last_seen_at)
                VALUES (%s, %s, now(), now())
                ON CONFLICT (user_id, name) DO UPDATE SET last_seen_at = now()
                """,
                (link["playerId"], link["observedName"]),
            )
            connection.execute(
                """
                INSERT INTO member_identity_links (normalized_name, observed_name, user_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (normalized_name) DO UPDATE SET
                    observed_name = EXCLUDED.observed_name,
                    user_id = EXCLUDED.user_id,
                    updated_at = now()
                """,
                (link["normalizedName"], link["observedName"], link["playerId"]),
            )
            unmatched_table = connection.execute(
                "SELECT to_regclass('public.unmatched_member_metrics')"
            ).fetchone()
            if unmatched_table and unmatched_table[0]:
                connection.execute(
                    """
                    INSERT INTO member_metrics (
                        snapshot_id, user_id, role, power, contribution_7d,
                        boss_attacks, last_activity_days, verification_note, raw_payload
                    )
                    SELECT snapshot_id, %s, role, power, contribution_7d,
                           boss_attacks, last_activity_days, verification_note, raw_payload
                    FROM unmatched_member_metrics
                    WHERE lower(trim(observed_name)) = lower(trim(%s))
                    ON CONFLICT (snapshot_id, user_id) DO NOTHING
                    """,
                    (link["playerId"], link["observedName"]),
                )
                connection.execute(
                    """
                    DELETE FROM unmatched_member_metrics
                    WHERE lower(trim(observed_name)) = lower(trim(%s))
                    """,
                    (link["observedName"],),
                )
            connection.execute(
                """
                UPDATE boss_daily_results
                SET user_id = %s
                WHERE user_id IS NULL AND lower(trim(player_name)) = lower(trim(%s))
                """,
                (link["playerId"], link["observedName"]),
            )


def _edit_database_identity(dsn: str, current_player_id: str, player_id: str, name: str) -> None:
    import psycopg

    normalized_name = normalize_name(name)
    with psycopg.connect(dsn) as connection:
        _ensure_database_table(connection)
        with connection.transaction():
            source = connection.execute(
                "SELECT 1 FROM guild_members WHERE user_id = %s FOR UPDATE",
                (current_player_id,),
            ).fetchone()
            if not source:
                raise ValueError(f"unknown player ID: {current_player_id}")
            if player_id != current_player_id:
                duplicate = connection.execute(
                    "SELECT 1 FROM guild_members WHERE user_id = %s",
                    (player_id,),
                ).fetchone()
                if duplicate:
                    raise ValueError(f"player ID already exists: {player_id}")
                connection.execute(
                    """
                    INSERT INTO guild_members (
                        user_id, current_name, display_name, discord_name, discord_linked,
                        status, joined_on, left_on, first_seen_at, last_seen_at, metadata
                    )
                    SELECT %s, %s, display_name, discord_name, discord_linked,
                           status, joined_on, left_on, first_seen_at, last_seen_at, metadata
                    FROM guild_members WHERE user_id = %s
                    """,
                    (player_id, name, current_player_id),
                )
                for table in ("member_names", "member_identity_links", "member_metrics", "boss_daily_results"):
                    connection.execute(
                        f"UPDATE {table} SET user_id = %s WHERE user_id = %s",
                        (player_id, current_player_id),
                    )
                connection.execute("DELETE FROM guild_members WHERE user_id = %s", (current_player_id,))
            else:
                connection.execute(
                    "UPDATE guild_members SET current_name = %s WHERE user_id = %s",
                    (name, player_id),
                )
            connection.execute(
                """
                INSERT INTO member_names (user_id, name, first_seen_at, last_seen_at)
                VALUES (%s, %s, now(), now())
                ON CONFLICT (user_id, name) DO UPDATE SET last_seen_at = now()
                """,
                (player_id, name),
            )
            connection.execute(
                """
                INSERT INTO member_identity_links (normalized_name, observed_name, user_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (normalized_name) DO UPDATE SET
                    observed_name = EXCLUDED.observed_name,
                    user_id = EXCLUDED.user_id,
                    updated_at = now()
                """,
                (normalized_name, name, player_id),
            )


def _set_database_status(dsn: str, player_id: str, status: str) -> None:
    import psycopg

    with psycopg.connect(dsn) as connection:
        result = connection.execute(
            """
            UPDATE guild_members
            SET status = %s,
                left_on = CASE WHEN %s = 'active' THEN NULL ELSE CURRENT_DATE END,
                last_seen_at = CASE WHEN %s = 'active' THEN now() ELSE last_seen_at END
            WHERE user_id = %s
            """,
            (status, status, status, player_id),
        )
        if result.rowcount != 1:
            raise ValueError(f"unknown player ID: {player_id}")


def _review_database_departure(dsn: str, player_id: str, decision: str) -> None:
    import psycopg

    with psycopg.connect(dsn) as connection:
        if decision == "restore":
            result = connection.execute(
                """
                UPDATE guild_members
                SET status = 'active',
                    left_on = NULL,
                    last_seen_at = now(),
                    metadata = COALESCE(metadata, '{}'::jsonb) - 'membershipReview'
                WHERE user_id = %s
                """,
                (player_id,),
            )
        else:
            result = connection.execute(
                """
                UPDATE guild_members
                SET status = 'left',
                    left_on = COALESCE(left_on, CURRENT_DATE),
                    metadata = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{membershipReview}',
                        jsonb_build_object(
                            'status', 'confirmed',
                            'detectedAt', COALESCE(metadata #>> '{membershipReview,detectedAt}', now()::text),
                            'reviewedAt', now()
                        ),
                        true
                    )
                WHERE user_id = %s
                """,
                (player_id,),
            )
        if result.rowcount != 1:
            raise ValueError(f"unknown player ID: {player_id}")


def _ensure_database_table(connection: object) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS member_identity_links (
            normalized_name TEXT PRIMARY KEY,
            observed_name TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES guild_members(user_id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """
    )


def _read_local_links(path: Path) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    if not isinstance(payload, list):
        raise ValueError(f"identity links must be a JSON array: {path}")
    return [item for item in payload if isinstance(item, dict)]


def _assign_local_link(path: Path, link: dict[str, str]) -> None:
    links = {
        item.get("normalizedName"): item
        for item in _read_local_links(path)
        if item.get("normalizedName")
    }
    links[link["normalizedName"]] = {
        **links.get(link["normalizedName"], {}),
        **link,
    }
    _write_local_links(path, list(links.values()))


def _edit_local_identity(path: Path, current_player_id: str, player_id: str, name: str) -> None:
    links = _read_local_links(path)
    found = False
    for link in links:
        if link.get("playerId") == current_player_id:
            link["playerId"] = player_id
            found = True
    if not found:
        raise ValueError(f"unknown player ID: {current_player_id}")
    normalized_name = normalize_name(name)
    links = [link for link in links if link.get("normalizedName") != normalized_name]
    links.append({"normalizedName": normalized_name, "observedName": name, "playerId": player_id})
    _write_local_links(path, links)


def _set_local_status(path: Path, player_id: str, status: str, observed_name: str) -> None:
    links = _read_local_links(path)
    matching = [item for item in links if item.get("playerId") == player_id]
    if not matching:
        name = " ".join(observed_name.strip().split())
        if not name:
            raise ValueError(f"unknown player ID: {player_id}")
        links.append(
            {
                "normalizedName": normalize_name(name),
                "observedName": name,
                "playerId": player_id,
            }
        )
        matching = [links[-1]]
    for link in matching:
        link["status"] = status
    _write_local_links(path, links)


def _review_local_departure(path: Path, player_id: str, decision: str, observed_name: str) -> None:
    links = _read_local_links(path)
    matching = [item for item in links if item.get("playerId") == player_id]
    if not matching:
        name = " ".join(observed_name.strip().split())
        if not name:
            raise ValueError(f"unknown player ID: {player_id}")
        links.append(
            {
                "normalizedName": normalize_name(name),
                "observedName": name,
                "playerId": player_id,
            }
        )
        matching = [links[-1]]
    for link in matching:
        if decision == "restore":
            link["status"] = "active"
            link.pop("departureReview", None)
        else:
            link["status"] = "left"
            link["departureReview"] = {"status": "confirmed"}
    _write_local_links(path, links)


def _write_local_links(path: Path, links: list[dict[str, Any]]) -> None:
    unique_links = {
        item.get("normalizedName"): item
        for item in links
        if item.get("normalizedName")
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(
                sorted(unique_links.values(), key=lambda item: item["observedName"].casefold()),
                handle,
                ensure_ascii=False,
                indent=2,
            )
            handle.write("\n")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Manage manual OCR member identity links.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list")
    assign_parser = subparsers.add_parser("assign")
    assign_parser.add_argument("observed_name")
    assign_parser.add_argument("player_id")
    edit_parser = subparsers.add_parser("edit")
    edit_parser.add_argument("current_player_id")
    edit_parser.add_argument("player_id")
    edit_parser.add_argument("observed_name")
    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("player_id")
    status_parser.add_argument("status", choices=sorted(_MEMBER_STATUSES))
    status_parser.add_argument("observed_name", nargs="?", default="")
    review_parser = subparsers.add_parser("departure-review")
    review_parser.add_argument("player_id")
    review_parser.add_argument("decision", choices=sorted(_DEPARTURE_REVIEW_DECISIONS))
    review_parser.add_argument("observed_name", nargs="?", default="")
    rename_parser = subparsers.add_parser("rename-unmatched")
    rename_parser.add_argument("capture_date")
    rename_parser.add_argument("source")
    rename_parser.add_argument("observed_name")
    args = parser.parse_args(argv)

    if args.command == "list":
        payload: object = {"links": list_identity_links()}
    elif args.command == "assign":
        payload = {"link": assign_identity(args.observed_name, args.player_id)}
    elif args.command == "edit":
        payload = {
            "member": edit_member_identity(
                args.current_player_id,
                args.player_id,
                args.observed_name,
            )
        }
    elif args.command == "status":
        payload = {
            "member": set_member_status(
                args.player_id,
                args.status,
                observed_name=args.observed_name,
            )
        }
    elif args.command == "departure-review":
        payload = {
            "member": review_member_departure(
                args.player_id,
                args.decision,
                observed_name=args.observed_name,
            )
        }
    else:
        payload = {
            "member": rename_unmatched_member(
                args.capture_date,
                args.source,
                args.observed_name,
            )
        }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
