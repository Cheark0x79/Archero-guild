"""Private evidence: never imported by dashboard exporters or public API readers."""
from __future__ import annotations

import base64
import hashlib
import json
import io
import re
import sys
import uuid

MAX_BYTES = 5 * 1024 * 1024
MAX_REQUEST = 7 * 1024 * 1024
TARGETS = {"import": "remote_import_batches", "correction": "guild_stat_snapshot_edits"}


def target(value):
    if not isinstance(value, dict) or value.get("kind") not in TARGETS:
        raise ValueError("invalid target kind")
    identifier = str(value.get("id", ""))
    if not re.fullmatch(r"[1-9][0-9]{0,17}", identifier):
        raise ValueError("invalid target ID")
    return value["kind"], int(identifier)


def image_bytes(value):
    if not isinstance(value, str) or len(value) > MAX_REQUEST:
        raise ValueError("invalid image size")
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid base64 image") from exc
    if not 1 <= len(data) <= MAX_BYTES:
        raise ValueError("image must be between 1 byte and 5 MiB")
    if not ((data.startswith(b"\x89PNG\r\n\x1a\n") and data.endswith(b"IEND\xaeB`\x82")) or (data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"))):
        raise ValueError("incomplete PNG/JPEG screenshot")
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in {"PNG", "JPEG"} or image.width * image.height > 16_000_000 or getattr(image, "n_frames", 1) != 1:
                raise ValueError("only bounded single-frame PNG/JPEG screenshots are accepted")
            mime = "image/png" if image.format == "PNG" else "image/jpeg"
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image.load()
    except (OSError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ValueError("invalid screenshot image") from exc
    return data, mime



def schema(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS private_screenshot_evidence (
            id UUID PRIMARY KEY, target_kind TEXT NOT NULL, target_id BIGINT NOT NULL,
            mime TEXT NOT NULL, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL,
            image BYTEA, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS private_screenshot_evidence_audit (
            id BIGSERIAL PRIMARY KEY, evidence_id UUID NOT NULL,
            action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """, prepare=False)


def exists(cursor, kind, identifier):
    table = TARGETS[kind]  # Fixed allowlist; never interpolate caller-provided identifiers.
    if cursor.execute("SELECT to_regclass(%s) AS name", (table,)).fetchone()["name"] is None:
        return False
    return cursor.execute(f"SELECT id FROM {table} WHERE id = %s FOR KEY SHARE", (identifier,)).fetchone() is not None


def metadata(row, target_present):
    return {"id": str(row["id"]), "target": {"kind": row["target_kind"], "id": str(row["target_id"])},
            "mime": row["mime"], "sha256": row["sha256"], "bytes": row["byte_size"],
            "createdAt": row["created_at"].isoformat(),
            "status": "deleted" if row["deleted_at"] else "available" if row.get("has_image", row.get("image") is not None) else "missing",
            "targetStatus": "available" if target_present else "missing"}


def execute(dsn, action, payload, actor="shared-admin"):
    if not dsn:
        raise RuntimeError("private evidence requires a configured database")
    import psycopg
    from psycopg.rows import dict_row

    if action not in {"upload", "list", "download", "delete", "audit"}:
        raise ValueError("invalid action")
    kind, identifier = target(payload.get("target")) if action in {"upload", "list"} else (None, None)
    data, mime = image_bytes(payload.get("image")) if action == "upload" else (None, None)
    evidence_id = str(uuid.UUID(str(payload.get("id")))) if action in {"download", "delete", "audit"} else str(uuid.uuid4())
    page_cursor = payload.get("cursor")
    if action == "list" and page_cursor is not None:
        page_cursor = str(uuid.UUID(str(page_cursor)))
    if action == "audit" and page_cursor is not None:
        if not isinstance(page_cursor, str) or not re.fullmatch(r"[1-9][0-9]{0,18}:[1-9][0-9]{0,18}", page_cursor):
            raise ValueError("invalid audit cursor")
        after, through = map(int, page_cursor.split(":"))
        if not 0 < after <= through <= 9223372036854775807:
            raise ValueError("invalid audit cursor")
    reason = payload.get("reason", "")
    if action == "delete" and (not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 500):
        raise ValueError("deletion requires a reason of 1 to 500 characters")
    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            schema(cursor)
            def audit(event):
                cursor.execute("INSERT INTO private_screenshot_evidence_audit (evidence_id, action, actor, reason) VALUES (%s,%s,%s,%s)",
                               (evidence_id, event, actor, reason.strip() if action == "delete" else ""))
            if action in {"upload", "list"}:
                present = exists(cursor, kind, identifier)
                if action == "upload":
                    if not present:
                        return {"status": 409, "error": "evidence target is missing or unavailable"}
                    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"evidence:{kind}:{identifier}",))
                    count = cursor.execute("SELECT count(*) AS total FROM private_screenshot_evidence WHERE target_kind=%s AND target_id=%s AND deleted_at IS NULL", (kind, identifier)).fetchone()["total"]
                    if count >= 100:
                        return {"status": 409, "error": "target evidence limit reached"}
                    row = cursor.execute("""INSERT INTO private_screenshot_evidence
                        (id,target_kind,target_id,mime,sha256,byte_size,image) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                        (evidence_id, kind, identifier, mime, hashlib.sha256(data).hexdigest(), len(data), data)).fetchone()
                    audit("upload")
                    return {"status": 201, "evidence": metadata(row, True)}
                position = None
                if page_cursor is not None:
                    position = cursor.execute("SELECT created_at,id FROM private_screenshot_evidence WHERE id=%s AND target_kind=%s AND target_id=%s", (page_cursor, kind, identifier)).fetchone()
                    if position is None:
                        raise ValueError("evidence cursor does not belong to this target")
                query = "SELECT id,target_kind,target_id,mime,sha256,byte_size,created_at,deleted_at,image IS NOT NULL AS has_image FROM private_screenshot_evidence WHERE target_kind=%s AND target_id=%s"
                parameters = [kind, identifier]
                if position is not None:
                    query += " AND (created_at,id) > (%s,%s)"
                    parameters.extend([position["created_at"], position["id"]])
                rows = cursor.execute(query + " ORDER BY created_at,id LIMIT 101", parameters).fetchall()
                for row in rows[:100]:
                    evidence_id = str(row["id"])
                    audit("list")
                return {"status": 200, "targetStatus": "available" if present else "missing", "evidence": [metadata(row, present) for row in rows[:100]], "truncated": len(rows) > 100, "nextCursor": str(rows[99]["id"]) if len(rows) > 100 else None}
            row = cursor.execute("SELECT * FROM private_screenshot_evidence WHERE id=%s FOR UPDATE", (evidence_id,)).fetchone()
            if not row:
                audit("missing")
                return {"status": 404, "error": "evidence not found"}
            if action == "audit":
                audit("audit-read")
                if page_cursor is None:
                    after = 0
                    through = cursor.execute("SELECT max(id) AS last FROM private_screenshot_evidence_audit WHERE evidence_id=%s", (evidence_id,)).fetchone()["last"]
                events = cursor.execute("SELECT id,action,actor,reason,created_at FROM private_screenshot_evidence_audit WHERE evidence_id=%s AND id>%s AND id<=%s ORDER BY id LIMIT 101", (evidence_id, after, through)).fetchall()
                return {"status": 200, "events": [{**e, "id": str(e["id"]), "created_at": e["created_at"].isoformat()} for e in events[:100]],
                        "nextCursor": f"{events[99]['id']}:{through}" if len(events) > 100 else None}
            if action == "delete":
                if not row["deleted_at"]:
                    cursor.execute("UPDATE private_screenshot_evidence SET image=NULL,deleted_at=now() WHERE id=%s", (evidence_id,))
                    audit("delete")
                return {"status": 200, "deleted": True}
            if row["image"] is None:
                audit("missing")
                return {"status": 410, "error": "evidence deleted" if row["deleted_at"] else "evidence missing"}
            if hashlib.sha256(bytes(row["image"])).hexdigest() != row["sha256"]:
                audit("integrity-failure")
                return {"status": 409, "error": "evidence integrity check failed"}
            audit("download")
            return {"status": 200, "image": base64.b64encode(row["image"]).decode(), "mime": row["mime"], "id": evidence_id}


def main():
    from archero_guild.storage.persistence import database_url_from_env
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError("request too large")
        request = json.loads(raw)
        result = execute(database_url_from_env(), request["action"], request["payload"])
    except (ValueError, KeyError, TypeError):
        result = {"status": 400, "error": "invalid evidence request"}
    except Exception:
        result = {"status": 503, "error": "private evidence storage unavailable"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
