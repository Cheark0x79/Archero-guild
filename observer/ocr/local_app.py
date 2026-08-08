from __future__ import annotations

import base64
import binascii
import json
import os
import re
import threading
import urllib.parse
from datetime import UTC, date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image

from observer.import_capture import read_roster_entries
from observer.ocr.publish import (
    PublishError,
    _validated_target,
    check_target,
    cloudflare_access_headers,
    fetch_import_history,
    publish_batch,
)
from observer.ocr.remote import RemoteOcrError, fetch_roster, run_day
from observer.ocr.review import (
    ReviewError,
    add_batch_row,
    apply_batch_edit,
    clear_reviewed_data,
    delete_batch_row,
    load_review_log,
    merge_reviewed_scope,
    prepare_export_batch,
    refresh_reviewed_batch,
    remove_reviewed_scope,
)
from observer.pipeline.guild_member_ocr import RosterEntry


MAX_REQUEST_BYTES = 64 * 1024 * 1024
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_FILES_PER_UPLOAD = 30
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CAPTURE_KINDS = {
    "guild-members": ("guild", "members"),
    "guild-boss": ("boss", "boss"),
}
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
JOB_LOCK = threading.Lock()
LOCAL_TARGET_KEY = "local"
SIMULATION_TARGET_KEY = "simulation"
TARGET_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
MAX_ROSTER_CACHE_ENTRIES = 500


class LocalOcrError(RuntimeError):
    pass


def merge_reviewed_roster(roster: list[RosterEntry], outbox_root: Path) -> list[RosterEntry]:
    reviewed: list[RosterEntry] = []
    reviewed_names: set[str] = set()
    reviewed_pairs: set[tuple[str, str]] = set()
    for batch_path in sorted(outbox_root.glob("*.json"), reverse=True):
        try:
            batch = json.loads(batch_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        for row in batch.get("members", []) if isinstance(batch, dict) else []:
            if not isinstance(row, dict):
                continue
            player_id = str(row.get("playerId") or "").strip()
            name = str(row.get("name") or "").strip()
            if not player_id or not name:
                continue
            normalized_name = name.casefold()
            pair = (player_id, normalized_name)
            if pair in reviewed_pairs or normalized_name in reviewed_names:
                continue
            reviewed.append(
                RosterEntry(
                    player_id=player_id,
                    name=name,
                    power_hint=row.get("power") if isinstance(row.get("power"), int) else None,
                )
            )
            reviewed_pairs.add(pair)
            reviewed_names.add(normalized_name)

    merged = list(reviewed)
    merged_pairs = set(reviewed_pairs)
    for entry in roster:
        normalized_name = entry.name.strip().casefold()
        pair = (entry.player_id, normalized_name)
        if pair in merged_pairs or normalized_name in reviewed_names:
            continue
        merged.append(entry)
        merged_pairs.add(pair)
    return merged


def load_targets(path: Path) -> dict[str, dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LocalOcrError(f"target configuration not found: {path}") from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LocalOcrError(f"target configuration is invalid: {path}") from exc
    if not isinstance(payload, dict) or not payload:
        raise LocalOcrError("target configuration must contain at least one environment")

    targets: dict[str, dict[str, Any]] = {}
    for key, raw in payload.items():
        if not TARGET_KEY_PATTERN.fullmatch(str(key)) or not isinstance(raw, dict):
            raise LocalOcrError(f"invalid target name: {key}")
        mode = str(raw.get("mode") or "remote").strip().lower()
        if mode not in {"local", "remote"}:
            raise LocalOcrError(f"{key} mode must be local or remote")
        target_url = ""
        ingestion_token = str(raw.get("ingestionToken") or "").strip()
        client_id = str(raw.get("cfAccessClientId") or "").strip()
        client_secret = str(raw.get("cfAccessClientSecret") or "").strip()
        configured = mode == "local"
        if mode == "remote":
            target_url = _validated_target(str(raw.get("url") or ""))
            if len(ingestion_token) < 16:
                raise LocalOcrError(f"{key} ingestion token must contain at least 16 characters")
            cloudflare_access_headers(client_id, client_secret)
            hostname = urllib.parse.urlparse(target_url).hostname or ""
            configured = not hostname.endswith(".example.com") and not ingestion_token.startswith(
                ("generate-", "replace-")
            )
        targets[str(key)] = {
            "label": str(raw.get("label") or key).strip()[:80],
            "mode": mode,
            "url": target_url,
            "ingestionToken": ingestion_token,
            "cfAccessClientId": client_id,
            "cfAccessClientSecret": client_secret,
            "configured": configured,
        }
    local_target = targets.get(LOCAL_TARGET_KEY)
    if local_target is None or local_target["mode"] != "local":
        raise LocalOcrError("target configuration must contain the protected local test destination")
    return targets


def _serialize_targets(targets: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        target_key: {
            "label": item["label"],
            "mode": item["mode"],
            **(
                {"url": item["url"], "ingestionToken": item["ingestionToken"]}
                if item["mode"] == "remote"
                else {}
            ),
            **({"cfAccessClientId": item["cfAccessClientId"]} if item.get("cfAccessClientId") else {}),
            **({"cfAccessClientSecret": item["cfAccessClientSecret"]} if item.get("cfAccessClientSecret") else {}),
        }
        for target_key, item in targets.items()
    }


def _write_private_json(path: Path, payload: object) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        path.chmod(0o600)
    except OSError as exc:
        raise LocalOcrError(f"could not save private OCR data: {exc}") from exc


def save_targets(path: Path, targets: dict[str, dict[str, Any]]) -> None:
    _write_private_json(path, _serialize_targets(targets))


def upsert_remote_target(
    path: Path,
    targets: dict[str, dict[str, Any]],
    *,
    key: str,
    label: str,
    url: str,
    ingestion_token: str,
    access_client_id: str = "",
    access_client_secret: str = "",
    clear_cloudflare_access: bool = False,
    create_only: bool = False,
) -> dict[str, Any]:
    key = key.strip().lower()
    label = label.strip()
    if key == LOCAL_TARGET_KEY:
        raise LocalOcrError("the local test destination cannot be changed")
    if not TARGET_KEY_PATTERN.fullmatch(key):
        raise LocalOcrError("destination identifier must start with a letter and contain only lowercase letters, numbers, or hyphens")
    if not label or len(label) > 80:
        raise LocalOcrError("destination name must contain between 1 and 80 characters")
    existing = targets.get(key)
    if create_only and existing is not None:
        raise LocalOcrError("a destination already uses this identifier")
    if existing is not None and existing.get("mode") != "remote":
        raise LocalOcrError("the local test destination cannot be changed")
    target_url = _validated_target(url)
    token = ingestion_token.strip() or str((existing or {}).get("ingestionToken") or "")
    if len(token) < 16 or token.startswith(("generate-", "replace-")):
        raise LocalOcrError("enter a real ingestion token containing at least 16 characters")
    if clear_cloudflare_access:
        client_id = ""
        client_secret = ""
    else:
        client_id = access_client_id.strip() or str((existing or {}).get("cfAccessClientId") or "")
        client_secret = access_client_secret.strip() or str((existing or {}).get("cfAccessClientSecret") or "")
    cloudflare_access_headers(client_id, client_secret)
    target = {
        "label": label,
        "mode": "remote",
        "url": target_url,
        "ingestionToken": token,
        "cfAccessClientId": client_id,
        "cfAccessClientSecret": client_secret,
        "configured": True,
    }
    targets[key] = target
    save_targets(path, targets)
    return target


def delete_remote_target(path: Path, targets: dict[str, dict[str, Any]], *, key: str) -> None:
    target = targets.get(key)
    if target is None:
        raise LocalOcrError("destination not found")
    if key == LOCAL_TARGET_KEY or target.get("mode") != "remote":
        raise LocalOcrError("the local test destination cannot be deleted")
    del targets[key]
    save_targets(path, targets)


def save_roster_cache(path: Path, roster: list[RosterEntry], *, key: str, label: str) -> dict[str, Any]:
    if not roster or len(roster) > MAX_ROSTER_CACHE_ENTRIES:
        raise LocalOcrError(f"roster cache must contain between 1 and {MAX_ROSTER_CACHE_ENTRIES} members")
    updated_at = datetime.now(UTC).isoformat()
    payload = {
        "version": 1,
        "updatedAt": updated_at,
        "source": {"key": key, "label": label},
        "members": [
            {"playerId": entry.player_id, "name": entry.name, "power": entry.power_hint}
            for entry in roster
        ],
    }
    _write_private_json(path, payload)
    return {"configured": True, "count": len(roster), "updatedAt": updated_at, "source": payload["source"]}


def load_roster_cache(path: Path) -> tuple[list[RosterEntry], dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [], {"configured": False, "count": 0, "updatedAt": None, "source": None}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LocalOcrError(f"roster cache is invalid: {path}") from exc
    if not isinstance(payload, dict) or payload.get("version") != 1 or not isinstance(payload.get("members"), list):
        raise LocalOcrError(f"roster cache is invalid: {path}")
    raw_members = payload["members"]
    if not raw_members or len(raw_members) > MAX_ROSTER_CACHE_ENTRIES:
        raise LocalOcrError(f"roster cache is invalid: {path}")
    roster: list[RosterEntry] = []
    for raw in raw_members:
        if not isinstance(raw, dict):
            raise LocalOcrError(f"roster cache is invalid: {path}")
        player_id = str(raw.get("playerId") or "").strip()
        name = str(raw.get("name") or "").strip()
        power = raw.get("power")
        if not player_id or not name or (power is not None and not isinstance(power, int)):
            raise LocalOcrError(f"roster cache is invalid: {path}")
        roster.append(RosterEntry(player_id=player_id, name=name, power_hint=power))
    source = payload.get("source") if isinstance(payload.get("source"), dict) else None
    metadata = {
        "configured": True,
        "count": len(roster),
        "updatedAt": str(payload.get("updatedAt") or ""),
        "source": {
            "key": str(source.get("key") or "") if source else "",
            "label": str(source.get("label") or "") if source else "",
        },
    }
    return roster, metadata


def store_uploaded_images(
    screenshots_root: Path,
    capture_date: str,
    kind: str,
    files: list[dict[str, Any]],
    *,
    replace_existing: bool = False,
) -> list[dict[str, Any]]:
    _validate_date(capture_date)
    if kind not in CAPTURE_KINDS:
        raise LocalOcrError("capture kind must be guild-members or guild-boss")
    if not files or len(files) > MAX_FILES_PER_UPLOAD:
        raise LocalOcrError(f"upload must contain between 1 and {MAX_FILES_PER_UPLOAD} PNG files")

    subdirectory, prefix = CAPTURE_KINDS[kind]
    validated: list[tuple[bytes, int, int]] = []
    for item in files:
        encoded = str(item.get("data") or "")
        if "," in encoded and encoded.startswith("data:"):
            encoded = encoded.split(",", 1)[1]
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise LocalOcrError("uploaded image contains invalid base64 data") from exc
        width, height = _validate_png(content)
        validated.append((content, width, height))

    destination = screenshots_root / capture_date / subdirectory
    destination.mkdir(parents=True, exist_ok=True)
    if replace_existing:
        archive_capture_session(screenshots_root, capture_date, kind)
    next_index = 1 if replace_existing else _next_capture_index(destination, prefix)
    saved: list[dict[str, Any]] = []
    for offset, (content, width, height) in enumerate(validated):
        filename = f"{prefix}-{next_index + offset:03d}.png"
        target = destination / filename
        temporary = destination / f".{filename}.{os.getpid()}.tmp"
        temporary.write_bytes(content)
        temporary.replace(target)
        saved.append({
            "name": filename,
            "kind": kind,
            "width": width,
            "height": height,
            "bytes": len(content),
        })
    return saved


def archive_capture_session(
    screenshots_root: Path,
    capture_date: str,
    kind: str,
) -> list[Path]:
    _validate_date(capture_date)
    if kind not in CAPTURE_KINDS:
        raise LocalOcrError("capture kind must be guild-members or guild-boss")
    subdirectory, prefix = CAPTURE_KINDS[kind]
    directory = screenshots_root / capture_date / subdirectory
    archived: list[Path] = []
    for image in sorted(directory.glob(f"{prefix}-*.png")) if directory.exists() else []:
        archived.append(move_capture_to_trash(screenshots_root, capture_date, kind, image.name))
    return archived


def day_payload(screenshots_root: Path, outbox_root: Path, capture_date: str) -> dict[str, Any]:
    _validate_date(capture_date)
    images = []
    for kind, (subdirectory, _) in CAPTURE_KINDS.items():
        directory = screenshots_root / capture_date / subdirectory
        for image in sorted(directory.glob("*.png")) if directory.exists() else []:
            images.append({
                "kind": kind,
                "name": image.name,
                "bytes": image.stat().st_size,
                "url": f"/api/image?date={capture_date}&kind={urllib.parse.quote(kind)}&name={urllib.parse.quote(image.name)}",
            })
    batch_path = outbox_root / f"{capture_date}.json"
    return {
        "date": capture_date,
        "images": images,
        "batchReady": batch_path.exists(),
        "batchPath": str(batch_path),
    }


def capture_image_path(screenshots_root: Path, capture_date: str, kind: str, name: str) -> Path:
    _validate_date(capture_date)
    if kind not in CAPTURE_KINDS or not re.fullmatch(r"[A-Za-z0-9._-]+\.png", name):
        raise LocalOcrError("invalid image path")
    return screenshots_root / capture_date / CAPTURE_KINDS[kind][0] / name


def selected_capture_paths(
    screenshots_root: Path,
    capture_date: str,
    selected: Any,
) -> tuple[list[Path], list[Path]]:
    if not isinstance(selected, list) or not selected or len(selected) > MAX_FILES_PER_UPLOAD:
        raise LocalOcrError(f"select between 1 and {MAX_FILES_PER_UPLOAD} screenshots for extraction")
    member_paths: list[Path] = []
    boss_paths: list[Path] = []
    seen: set[Path] = set()
    for item in selected:
        if not isinstance(item, dict):
            raise LocalOcrError("selected screenshots are invalid")
        kind = str(item.get("kind") or "")
        path = capture_image_path(
            screenshots_root,
            capture_date,
            kind,
            str(item.get("name") or ""),
        )
        if path in seen:
            continue
        if not path.exists():
            raise LocalOcrError(f"selected screenshot no longer exists: {path.name}")
        seen.add(path)
        if kind == "guild-members":
            member_paths.append(path)
        else:
            boss_paths.append(path)
    if member_paths and boss_paths:
        raise LocalOcrError("extract guild members and guild boss as two separate batches")
    return member_paths, boss_paths


def move_capture_to_trash(
    screenshots_root: Path,
    capture_date: str,
    kind: str,
    name: str,
    *,
    timestamp: str | None = None,
) -> Path:
    source = capture_image_path(screenshots_root, capture_date, kind, name)
    if not source.exists():
        raise LocalOcrError("the screenshot no longer exists")
    subdirectory = CAPTURE_KINDS[kind][0]
    trash = screenshots_root / ".trash" / capture_date / subdirectory
    trash.mkdir(parents=True, exist_ok=True)
    stamp = timestamp or datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    destination = trash / f"{stamp}-{name}"
    source.replace(destination)
    return destination


def configured_target_public(targets: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    configured = [
        {
            "key": key,
            "label": target["label"],
            "url": target["url"],
            "mode": target["mode"],
            "configured": target["configured"],
            "publishable": target["mode"] == "remote" and target["configured"],
            "hasToken": bool(target["ingestionToken"]),
            "cloudflareAccess": bool(target["cfAccessClientId"]),
        }
        for key, target in targets.items()
    ]
    configured.insert(1, {
        "key": SIMULATION_TARGET_KEY,
        "label": "Local simulation",
        "url": "",
        "mode": "simulation",
        "configured": True,
        "publishable": True,
        "hasToken": False,
        "cloudflareAccess": False,
    })
    return configured


def build_demo_batch(capture_date: str, agent_version: str) -> dict[str, Any]:
    _validate_date(capture_date)
    members = [
        ("demo-001", "Astra", "leader", 2_450_000, 1250, 3, 0),
        ("demo-002", "Boreal", "officer", 1_980_000, 980, 2, 1),
        ("demo-003", "Cypher", "elder", 1_520_000, 740, 2, 2),
        ("demo-004", "Dahlia", "member", 1_110_000, 510, 1, 3),
    ]
    bosses = [
        (1, "Astra", "2.45B", 2_450_000_000),
        (2, "Boreal", "1.98B", 1_980_000_000),
        (3, "Cypher", "1.52B", 1_520_000_000),
        (4, "Dahlia", "910M", 910_000_000),
    ]
    batch = {
        "schemaVersion": 1,
        "captureDate": capture_date,
        "generatedAt": f"{capture_date}T12:00:00+02:00",
        "agentVersion": f"{agent_version}-simulation",
        "idempotencyKey": "",
        "simulation": True,
        "sourceImages": [
            {"kind": "guild-members", "sha256": "1" * 64, "width": 1080, "height": 1920, "detectedRows": len(members), "sourceName": "demo-members.png"},
            {"kind": "guild-boss", "sha256": "2" * 64, "width": 1080, "height": 1920, "detectedRows": len(bosses), "sourceName": "demo-boss.png"},
        ],
        "members": [
            {
                "playerId": player_id, "name": name, "rawName": name, "role": role,
                "power": power, "powerText": _compact_demo(power), "contribution7d": donation,
                "bossAttacks": attacks, "lastActivityDays": inactive, "activityText": f"{inactive} d",
                "roleText": role.title(), "rawActivity": f"{inactive} d", "rawRole": role,
                "source": "demo-members.png", "matchScore": 1,
            }
            for player_id, name, role, power, donation, attacks, inactive in members
        ],
        "bossRankings": [
            {
                "playerId": f"demo-{rank:03d}", "name": name, "rawName": name, "rank": rank,
                "damageText": damage_text, "damage": damage, "area": "podium" if rank <= 3 else "list",
                "rowIndex": rank - 1, "source": "demo-boss.png",
            }
            for rank, name, damage_text, damage in bosses
        ],
        "quality": {},
    }
    refresh_reviewed_batch(batch)
    return batch


def _compact_demo(value: int) -> str:
    return f"{value / 1_000_000:.2f}M".rstrip("0").rstrip(".")


def simulation_publish(outbox_root: Path, batch: dict[str, Any]) -> dict[str, Any]:
    _validate_simulation_batch(batch)
    history_path = outbox_root / "simulation-history.json"
    try:
        history = json.loads(history_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        history = []
    if not isinstance(history, list):
        history = []
    existing = next((item for item in history if item.get("idempotencyKey") == batch["idempotencyKey"]), None)
    if existing:
        return {**existing["public"], "replayed": True}
    import_id = f"SIM-{len(history) + 1:04d}"
    public = {
        "id": import_id,
        "status": "published",
        "replayed": False,
        "result": {
            "captureDate": batch["captureDate"],
            "members": len(batch.get("members", [])),
            "bossRankings": len(batch.get("bossRankings", [])),
        },
    }
    history.insert(0, {
        "idempotencyKey": batch["idempotencyKey"],
        "public": public,
        "createdAt": datetime.now(UTC).isoformat(),
    })
    _write_private_json(history_path, history[:50])
    return public


def simulation_history(outbox_root: Path, *, limit: int = 10) -> list[dict[str, Any]]:
    try:
        history = json.loads((outbox_root / "simulation-history.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    if not isinstance(history, list):
        return []
    return [
        {
            "id": item["public"]["id"],
            "captureDate": item["public"]["result"]["captureDate"],
            "status": item["public"]["status"],
            "members": item["public"]["result"]["members"],
            "bossRankings": item["public"]["result"]["bossRankings"],
            "createdAt": item.get("createdAt"),
            "publishedAt": item.get("createdAt"),
        }
        for item in history[:limit]
        if isinstance(item, dict) and isinstance(item.get("public"), dict)
    ]


def _validate_simulation_batch(batch: object) -> None:
    if not isinstance(batch, dict) or batch.get("simulation") is not True:
        raise LocalOcrError("simulation can only use a demonstration batch")
    members = batch.get("members")
    bosses = batch.get("bossRankings")
    if batch.get("quality", {}).get("coverage") != 1 or not isinstance(members, list) or not members:
        raise LocalOcrError("the demonstration member review is incomplete")
    player_ids = [row.get("playerId") for row in members if isinstance(row, dict) and row.get("playerId")]
    if len(player_ids) != len(set(player_ids)) or any(not str(row.get("name") or "").strip() for row in members if isinstance(row, dict)):
        raise LocalOcrError("the demonstration member review contains unresolved identities")
    if not isinstance(bosses, list) or not bosses or any(
        not isinstance(row, dict)
        or not isinstance(row.get("rank"), int)
        or not str(row.get("name") or "").strip()
        or not isinstance(row.get("damage"), int)
        or not str(row.get("damageText") or "").strip()
        for row in bosses
    ):
        raise LocalOcrError("the demonstration Boss review is incomplete")


def update_remote_target(
    path: Path,
    targets: dict[str, dict[str, Any]],
    *,
    key: str,
    url: str,
    ingestion_token: str,
) -> dict[str, Any]:
    target = targets.get(key)
    if target is None or target.get("mode") != "remote":
        raise LocalOcrError("select a configured remote destination")
    return upsert_remote_target(
        path,
        targets,
        key=key,
        label=target["label"],
        url=url,
        ingestion_token=ingestion_token,
    )


class LocalOcrHandler(BaseHTTPRequestHandler):
    server_version = "ArcheroLocalOCR/1"

    @property
    def app(self) -> "LocalOcrServer":
        return self.server  # type: ignore[return-value]

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/":
                self._send_file(self.app.ui_root / "index.html", "text/html; charset=utf-8")
                return
            if parsed.path.startswith("/assets/"):
                name = parsed.path.removeprefix("/assets/")
                if name not in {"app.js", "styles.css"}:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                content_type = "text/javascript; charset=utf-8" if name.endswith(".js") else "text/css; charset=utf-8"
                self._send_file(self.app.ui_root / name, content_type)
                return
            if parsed.path == "/api/status":
                dates = sorted(
                    {
                        entry.name
                        for entry in self.app.screenshots_root.iterdir()
                        if entry.is_dir() and DATE_PATTERN.fullmatch(entry.name)
                    },
                    reverse=True,
                ) if self.app.screenshots_root.exists() else []
                _, roster_cache = load_roster_cache(self.app.roster_cache_path)
                self._send_json({
                    "ok": True,
                    "service": "archero-local-ocr",
                    "busy": JOB_LOCK.locked(),
                    "agentVersion": self.app.agent_version,
                    "targets": configured_target_public(self.app.targets),
                    "rosterCache": roster_cache,
                    "dates": dates,
                })
                return
            if parsed.path == "/api/day":
                capture_date = self._query_value(parsed, "date")
                self._send_json({"ok": True, **day_payload(self.app.screenshots_root, self.app.outbox_root, capture_date)})
                return
            if parsed.path == "/api/batch":
                capture_date = self._query_value(parsed, "date")
                _validate_date(capture_date)
                batch_path = self.app.outbox_root / f"{capture_date}.json"
                if not batch_path.exists():
                    raise LocalOcrError("no reviewed OCR batch exists for this date")
                corrections = load_review_log(self._corrections_path(capture_date), capture_date)
                batch = json.loads(batch_path.read_text(encoding="utf-8"))
                if not isinstance(batch, dict):
                    raise LocalOcrError("the reviewed OCR batch is invalid")
                # Recalculate legacy batches in memory so old overlapping Boss
                # captures immediately benefit from the current quality rules.
                refresh_reviewed_batch(batch)
                self._send_json({
                    "ok": True,
                    "batch": batch,
                    "corrections": corrections,
                })
                return
            if parsed.path == "/api/missing-members":
                self._send_missing_members(parsed)
                return
            if parsed.path == "/api/import-history":
                target_key = self._query_value(parsed, "target")
                if target_key == SIMULATION_TARGET_KEY:
                    self._send_json({"ok": True, "history": simulation_history(self.app.outbox_root)})
                    return
                target = self.app.targets.get(target_key)
                if target is None or target["mode"] != "remote" or not target["configured"]:
                    raise LocalOcrError("select a configured remote destination")
                history = fetch_import_history(
                    target["url"],
                    target["ingestionToken"],
                    limit=10,
                    access_client_id=target["cfAccessClientId"],
                    access_client_secret=target["cfAccessClientSecret"],
                )
                self._send_json({"ok": True, "history": history})
                return
            if parsed.path == "/api/image":
                self._send_capture_image(parsed)
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except (LocalOcrError, ReviewError, OSError, ValueError, json.JSONDecodeError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_POST(self) -> None:
        try:
            self._validate_browser_origin()
            payload = self._read_json()
            if self.path == "/api/upload":
                self._upload_capture_session(payload)
                return
            if self.path == "/api/demo":
                self._load_demo_batch(payload)
                return
            if self.path == "/api/scan":
                self._run_ocr_action(payload, publish=False)
                return
            if self.path == "/api/publish":
                self._run_ocr_action(payload, publish=True)
                return
            if self.path == "/api/preflight":
                self._preflight_publish(payload)
                return
            if self.path == "/api/edit":
                self._edit_reviewed_row(payload)
                return
            if self.path == "/api/delete-row":
                self._delete_reviewed_row(payload)
                return
            if self.path == "/api/add-row":
                self._add_reviewed_row(payload)
                return
            if self.path == "/api/clear":
                self._clear_reviewed_data(payload)
                return
            if self.path == "/api/session/reset":
                self._reset_capture_session(payload)
                return
            if self.path == "/api/targets":
                key = str(payload.get("key") or "").strip().lower()
                upsert_remote_target(
                    self.app.targets_file,
                    self.app.targets,
                    key=key,
                    label=str(payload.get("label") or ""),
                    url=str(payload.get("url") or ""),
                    ingestion_token=str(payload.get("ingestionToken") or ""),
                    access_client_id=str(payload.get("cfAccessClientId") or ""),
                    access_client_secret=str(payload.get("cfAccessClientSecret") or ""),
                    clear_cloudflare_access=payload.get("clearCloudflareAccess") is True,
                    create_only=payload.get("createOnly") is True,
                )
                self._send_json({
                    "ok": True,
                    "target": next(item for item in configured_target_public(self.app.targets) if item["key"] == key),
                })
                return
            if self.path == "/api/targets/delete":
                key = str(payload.get("key") or "")
                delete_remote_target(self.app.targets_file, self.app.targets, key=key)
                self._send_json({"ok": True, "deleted": key})
                return
            if self.path == "/api/roster/sync":
                self._sync_roster(payload)
                return
            if self.path == "/api/target":
                target = update_remote_target(
                    self.app.targets_file,
                    self.app.targets,
                    key=str(payload.get("target") or ""),
                    url=str(payload.get("url") or ""),
                    ingestion_token=str(payload.get("ingestionToken") or ""),
                )
                self._send_json({
                    "ok": True,
                    "target": next(
                        item
                        for item in configured_target_public(self.app.targets)
                        if item["key"] == str(payload.get("target") or "")
                    ),
                })
                return
            if self.path == "/api/image/remove":
                self._remove_capture_image(payload)
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except LocalOcrError as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except (RemoteOcrError, PublishError, ReviewError, OSError, ValueError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.UNPROCESSABLE_ENTITY)

    def _upload_capture_session(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        kind = str(payload.get("kind") or "")
        _validate_date(capture_date)
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            saved = store_uploaded_images(
                self.app.screenshots_root,
                capture_date,
                kind,
                payload.get("files") if isinstance(payload.get("files"), list) else [],
                replace_existing=True,
            )
            removed = remove_reviewed_scope(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
                capture_date,
                kind,
            )
        finally:
            JOB_LOCK.release()
        self._send_json({
            "ok": True,
            "files": saved,
            "replacedSession": True,
            "reviewedDataInvalidated": removed,
        }, HTTPStatus.CREATED)

    def _load_demo_batch(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        _validate_date(capture_date)
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            batch = build_demo_batch(capture_date, self.app.agent_version)
            _write_private_json(self._batch_path(capture_date, simulation=True), batch)
            _write_private_json(
                self._corrections_path(capture_date, simulation=True),
                {"schemaVersion": 1, "captureDate": capture_date, "updatedAt": None, "entries": []},
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "batch": batch}, HTTPStatus.CREATED)

    def _reset_capture_session(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        kind = str(payload.get("kind") or "")
        _validate_date(capture_date)
        if payload.get("confirmation") != f"RESET {capture_date} {kind}":
            raise LocalOcrError("invalid reset confirmation")
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            archived = archive_capture_session(self.app.screenshots_root, capture_date, kind)
            removed = remove_reviewed_scope(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
                capture_date,
                kind,
            )
        finally:
            JOB_LOCK.release()
        self._send_json({
            "ok": True,
            "archivedImages": len(archived),
            "reviewedDataInvalidated": removed,
        })

    def _run_ocr_action(self, payload: dict[str, Any], *, publish: bool) -> None:
        capture_date = str(payload.get("date") or "")
        session_date = str(payload.get("sessionDate") or capture_date) if publish else capture_date
        target_key = str(payload.get("target") or "") if publish else "local"
        _validate_date(capture_date)
        _validate_date(session_date)
        target = self.app.targets.get(target_key)
        if publish and target_key == SIMULATION_TARGET_KEY:
            if payload.get("confirmation") != "PUBLISH SIMULATION":
                raise LocalOcrError("invalid simulation confirmation")
            batch_path = self._batch_path(session_date, simulation=True)
            try:
                local_batch = json.loads(batch_path.read_text(encoding="utf-8"))
            except FileNotFoundError as exc:
                raise LocalOcrError("no reviewed OCR batch exists for this local session") from exc
            _validate_simulation_batch(local_batch)
            batch = prepare_export_batch(local_batch, capture_date)
            if not JOB_LOCK.acquire(blocking=False):
                self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
                return
            try:
                imported = simulation_publish(self.app.outbox_root, batch)
            finally:
                JOB_LOCK.release()
            self._send_json({
                "ok": True,
                "result": {
                    "captureDate": capture_date,
                    "sessionDate": session_date,
                    "quality": batch["quality"],
                    "validated": True,
                    "published": True,
                    "simulation": True,
                    "import": imported,
                },
            })
            return
        if target is None:
            raise LocalOcrError("select a configured target")
        if target["mode"] == "remote" and not target["configured"]:
            raise LocalOcrError(
                f"{target_key} is still a placeholder; configure its real URL and ingestion token in ocr/targets.json"
            )
        if publish and target["mode"] == "local":
            raise LocalOcrError("Local test is review-only; choose preprod or prod to publish")
        if publish and payload.get("confirmation") != f"PUBLISH {target_key.upper()}":
            raise LocalOcrError(f"type PUBLISH {target_key.upper()} to confirm this publication")
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            if publish:
                batch_path = self.app.outbox_root / f"{session_date}.json"
                try:
                    local_batch = json.loads(batch_path.read_text(encoding="utf-8"))
                except FileNotFoundError as exc:
                    raise LocalOcrError("no reviewed OCR batch exists for this local session") from exc
                if not isinstance(local_batch, dict) or local_batch.get("captureDate") != session_date:
                    raise LocalOcrError("the reviewed OCR batch does not match the local session")
                batch = prepare_export_batch(local_batch, capture_date)
                check_target(
                    target["url"],
                    target["ingestionToken"],
                    timeout=15,
                    access_client_id=target["cfAccessClientId"],
                    access_client_secret=target["cfAccessClientSecret"],
                )
                published = publish_batch(
                    batch,
                    target=target["url"],
                    token=target["ingestionToken"],
                    timeout=30,
                    import_timeout=180,
                    access_client_id=target["cfAccessClientId"],
                    access_client_secret=target["cfAccessClientSecret"],
                )
                result = {
                    "captureDate": capture_date,
                    "sessionDate": session_date,
                    "output": str(batch_path),
                    "quality": batch["quality"],
                    **published,
                }
                self._send_json({"ok": True, "result": result})
                return
            member_paths: list[Path] | None = None
            boss_paths: list[Path] | None = None
            existing_batch: dict[str, Any] | None = None
            if not publish:
                member_paths, boss_paths = selected_capture_paths(
                    self.app.screenshots_root,
                    capture_date,
                    payload.get("images"),
                )
                batch_path = self.app.outbox_root / f"{capture_date}.json"
                if batch_path.exists():
                    loaded = json.loads(batch_path.read_text(encoding="utf-8"))
                    existing_batch = loaded if isinstance(loaded, dict) else None
            if target["mode"] == "local":
                roster, roster_source = self._scan_roster()
                result = run_day(
                    capture_date=capture_date,
                    screenshots_root=self.app.screenshots_root,
                    output=self.app.outbox_root / f"{capture_date}.json",
                    target="http://local.invalid",
                    token="local-review-only",
                    agent_version=self.app.agent_version,
                    publish=False,
                    roster=roster,
                    validate_remote=False,
                    member_paths=member_paths,
                    boss_paths=boss_paths,
                    timeout=180,
                )
                result["rosterSource"] = roster_source
            else:
                if publish:
                    check_target(
                        target["url"],
                        target["ingestionToken"],
                        timeout=15,
                        access_client_id=target["cfAccessClientId"],
                        access_client_secret=target["cfAccessClientSecret"],
                    )
                roster = None
                roster_source = None
                if not publish:
                    roster, roster_source = self._scan_roster((target_key, target))
                result = run_day(
                    capture_date=capture_date,
                    screenshots_root=self.app.screenshots_root,
                    output=self.app.outbox_root / f"{capture_date}.json",
                    target=target["url"],
                    token=target["ingestionToken"],
                    agent_version=self.app.agent_version,
                    publish=publish,
                    roster=roster,
                    timeout=180,
                    access_client_id=target["cfAccessClientId"],
                    access_client_secret=target["cfAccessClientSecret"],
                )
                if roster_source is not None:
                    result["rosterSource"] = roster_source
            if not publish:
                batch_path = self.app.outbox_root / f"{capture_date}.json"
                incoming = json.loads(batch_path.read_text(encoding="utf-8"))
                combined = merge_reviewed_scope(existing_batch, incoming)
                _write_private_json(batch_path, combined)
                result["quality"] = combined["quality"]
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "result": result})

    def _scan_roster(self, preferred: tuple[str, dict[str, Any]] | None = None):
        if preferred is not None:
            target_key, target = preferred
            try:
                roster = fetch_roster(
                    target["url"],
                    target["ingestionToken"],
                    timeout=15,
                    access_client_id=target["cfAccessClientId"],
                    access_client_secret=target["cfAccessClientSecret"],
                )
            except RemoteOcrError as exc:
                raise LocalOcrError(f"could not synchronize roster from {target['label']}: {exc}") from exc
            if roster:
                save_roster_cache(
                    self.app.roster_cache_path,
                    roster,
                    key=target_key,
                    label=target["label"],
                )
                merged = merge_reviewed_roster(roster, self.app.outbox_root)
                return merged, {
                    "type": "database",
                    "target": target_key,
                    "label": target["label"],
                    "localReviewedIdentities": len(merged) - len(roster),
                }
        roster, cache = load_roster_cache(self.app.roster_cache_path)
        if roster:
            merged = merge_reviewed_roster(roster, self.app.outbox_root)
            return merged, {
                "type": "local-cache",
                "label": cache["source"]["label"] or "local roster cache",
                "updatedAt": cache["updatedAt"],
                "localReviewedIdentities": len(merged) - len(roster),
            }
        roster = read_roster_entries(self.app.local_roster_path)
        if not roster:
            raise LocalOcrError(f"OCR roster is empty: {self.app.local_roster_path}")
        merged = merge_reviewed_roster(roster, self.app.outbox_root)
        return merged, {
            "type": "local-fallback",
            "label": "local fallback roster",
            "localReviewedIdentities": len(merged) - len(roster),
        }

    def _sync_roster(self, payload: dict[str, Any]) -> None:
        target_key = str(payload.get("target") or "")
        target = self.app.targets.get(target_key)
        if target is None or target["mode"] != "remote" or not target["configured"]:
            raise LocalOcrError("select a configured remote destination")
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            roster = fetch_roster(
                target["url"],
                target["ingestionToken"],
                timeout=15,
                access_client_id=target["cfAccessClientId"],
                access_client_secret=target["cfAccessClientSecret"],
            )
            cache = save_roster_cache(
                self.app.roster_cache_path,
                roster,
                key=target_key,
                label=target["label"],
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "rosterCache": cache})

    def _preflight_publish(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        session_date = str(payload.get("sessionDate") or capture_date)
        target_key = str(payload.get("target") or "")
        _validate_date(capture_date)
        _validate_date(session_date)
        if target_key == SIMULATION_TARGET_KEY:
            batch_path = self._batch_path(session_date, simulation=True)
            if not batch_path.exists():
                raise LocalOcrError("no reviewed OCR batch exists for this date")
            batch = json.loads(batch_path.read_text(encoding="utf-8"))
            _validate_simulation_batch(batch)
            self._send_json({
                "ok": True,
                "readiness": {"reachable": True, "database": False, "simulation": True},
                "result": {"validated": True, "published": False, "simulation": True},
            })
            return
        target = self.app.targets.get(target_key)
        if target is None or target["mode"] != "remote" or not target["configured"]:
            raise LocalOcrError("select a configured remote destination")
        batch_path = self.app.outbox_root / f"{session_date}.json"
        if not batch_path.exists():
            raise LocalOcrError("no reviewed OCR batch exists for this date")
        batch = json.loads(batch_path.read_text(encoding="utf-8"))
        if not isinstance(batch, dict) or batch.get("captureDate") != session_date:
            raise LocalOcrError("the reviewed OCR batch does not match the local session")
        batch = prepare_export_batch(batch, capture_date)
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            readiness = check_target(
                target["url"],
                target["ingestionToken"],
                timeout=15,
                access_client_id=target["cfAccessClientId"],
                access_client_secret=target["cfAccessClientSecret"],
            )
            result = publish_batch(
                batch,
                target=target["url"],
                token=target["ingestionToken"],
                validate_only=True,
                timeout=20,
                access_client_id=target["cfAccessClientId"],
                access_client_secret=target["cfAccessClientSecret"],
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "readiness": readiness, "result": result})

    def _remove_capture_image(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        kind = str(payload.get("kind") or "")
        name = str(payload.get("name") or "")
        _validate_date(capture_date)
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            move_capture_to_trash(self.app.screenshots_root, capture_date, kind, name)
            removed = remove_reviewed_scope(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
                capture_date,
                kind,
            )
        finally:
            JOB_LOCK.release()
        self._send_json({
            "ok": True,
            "removed": name,
            "movedToTrash": True,
            "reviewedDataInvalidated": removed,
        })

    def _edit_reviewed_row(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        _validate_date(capture_date)
        try:
            row_index = int(payload.get("rowIndex"))
        except (TypeError, ValueError) as exc:
            raise LocalOcrError("rowIndex must be an integer") from exc
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            batch_path, corrections_path = self._review_paths(payload, capture_date)
            batch, corrections = apply_batch_edit(
                batch_path,
                corrections_path,
                capture_date=capture_date,
                category=str(payload.get("category") or ""),
                row_index=row_index,
                field=str(payload.get("field") or ""),
                value=payload.get("value"),
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "batch": batch, "corrections": corrections})

    def _delete_reviewed_row(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        _validate_date(capture_date)
        try:
            row_index = int(payload.get("rowIndex"))
        except (TypeError, ValueError) as exc:
            raise LocalOcrError("rowIndex must be an integer") from exc
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            batch_path, corrections_path = self._review_paths(payload, capture_date)
            batch, corrections = delete_batch_row(
                batch_path,
                corrections_path,
                capture_date=capture_date,
                category=str(payload.get("category") or ""),
                row_index=row_index,
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "batch": batch, "corrections": corrections})

    def _add_reviewed_row(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        _validate_date(capture_date)
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            batch_path, corrections_path = self._review_paths(payload, capture_date)
            batch, corrections = add_batch_row(
                batch_path,
                corrections_path,
                capture_date=capture_date,
                category=str(payload.get("category") or ""),
                initial=payload.get("initial") if isinstance(payload.get("initial"), dict) else {},
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "batch": batch, "corrections": corrections})

    def _clear_reviewed_data(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        _validate_date(capture_date)
        if payload.get("confirmation") != f"CLEAR {capture_date}":
            raise LocalOcrError(f"type CLEAR {capture_date} to clear extracted data")
        if not JOB_LOCK.acquire(blocking=False):
            self._send_json({"ok": False, "error": "another OCR action is already running"}, HTTPStatus.CONFLICT)
            return
        try:
            batch_path, corrections_path = self._review_paths(payload, capture_date)
            removed = clear_reviewed_data(
                batch_path,
                corrections_path,
                capture_date,
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "removed": removed})

    def _batch_path(self, capture_date: str, *, simulation: bool = False) -> Path:
        root = self.app.outbox_root / ".simulation" if simulation else self.app.outbox_root
        return root / f"{capture_date}.json"

    def _corrections_path(self, capture_date: str, *, simulation: bool = False) -> Path:
        root = self.app.outbox_root / ".simulation" if simulation else self.app.outbox_root
        return root / "corrections" / f"{capture_date}.json"

    def _review_paths(self, payload: dict[str, Any], capture_date: str) -> tuple[Path, Path]:
        simulation = payload.get("simulation") is True
        return (
            self._batch_path(capture_date, simulation=simulation),
            self._corrections_path(capture_date, simulation=simulation),
        )

    def _send_capture_image(self, parsed: urllib.parse.ParseResult) -> None:
        capture_date = self._query_value(parsed, "date")
        kind = self._query_value(parsed, "kind")
        name = self._query_value(parsed, "name")
        _validate_date(capture_date)
        image = capture_image_path(self.app.screenshots_root, capture_date, kind, name)
        self._send_file(image, "image/png")

    def _send_missing_members(self, parsed: urllib.parse.ParseResult) -> None:
        capture_date = self._query_value(parsed, "date")
        _validate_date(capture_date)
        batch_path = self.app.outbox_root / f"{capture_date}.json"
        try:
            batch = json.loads(batch_path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise LocalOcrError("no reviewed OCR batch exists for this date") from exc
        source_kinds = {
            image.get("kind")
            for image in batch.get("sourceImages", [])
            if isinstance(image, dict)
        }
        if "guild-members" not in source_kinds:
            self._send_json({"ok": True, "members": [], "target": None})
            return
        roster, roster_source = self._scan_roster()
        present_ids = {
            str(row.get("playerId"))
            for row in batch.get("members", [])
            if isinstance(row, dict) and row.get("playerId")
        }
        missing = [
            {
                "playerId": member.player_id,
                "name": member.name,
                "power": member.power_hint,
            }
            for member in roster
            if member.player_id not in present_ids
        ]
        self._send_json({
            "ok": True,
            "members": missing,
            "target": {"key": "local", "label": roster_source["label"]},
        })

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or "")
        except ValueError as exc:
            raise LocalOcrError("Content-Length is required") from exc
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise LocalOcrError("request body is empty or too large")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalOcrError("request body must contain valid JSON") from exc
        if not isinstance(payload, dict):
            raise LocalOcrError("request body must contain a JSON object")
        return payload

    def _validate_browser_origin(self) -> None:
        origin = self.headers.get("Origin")
        if not origin:
            return
        parsed = urllib.parse.urlparse(origin)
        if parsed.scheme != "http" or parsed.hostname not in self.app.public_hosts:
            raise LocalOcrError("cross-origin requests are not allowed")
        if parsed.port not in {self.app.public_port, None}:
            raise LocalOcrError("cross-origin requests are not allowed")

    @staticmethod
    def _query_value(parsed: urllib.parse.ParseResult, name: str) -> str:
        value = urllib.parse.parse_qs(parsed.query).get(name, [""])[0]
        if not value:
            raise LocalOcrError(f"{name} is required")
        return value

    def _send_file(self, path: Path, content_type: str) -> None:
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def _send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, message: str, *args: object) -> None:
        print(f"{self.address_string()} - {message % args}")


class LocalOcrServer(ThreadingHTTPServer):
    def __init__(
        self,
        address: tuple[str, int],
        *,
        screenshots_root: Path,
        outbox_root: Path,
        targets: dict[str, dict[str, Any]],
        targets_file: Path,
        roster_cache_path: Path,
        ui_root: Path,
        local_roster_path: Path,
        agent_version: str,
        public_port: int,
        public_host: str,
    ) -> None:
        super().__init__(address, LocalOcrHandler)
        self.screenshots_root = screenshots_root
        self.outbox_root = outbox_root
        self.targets = targets
        self.targets_file = targets_file
        self.roster_cache_path = roster_cache_path
        self.ui_root = ui_root
        self.local_roster_path = local_roster_path
        self.agent_version = agent_version
        self.public_port = public_port
        self.public_hosts = {"127.0.0.1", "localhost", public_host}


def main() -> int:
    host = os.environ.get("ARCHERO_OCR_UI_HOST", "127.0.0.1")
    port = int(os.environ.get("ARCHERO_OCR_UI_PORT", "5190"))
    public_port = int(os.environ.get("ARCHERO_OCR_PUBLIC_PORT", str(port)))
    public_host = os.environ.get("ARCHERO_OCR_PUBLIC_HOST", "127.0.0.1").strip()
    screenshots_root = Path(os.environ.get("ARCHERO_SCREENSHOTS_ROOT", "/captures"))
    outbox_root = Path(os.environ.get("ARCHERO_OUTBOX_ROOT", "/outbox"))
    targets_file = Path(os.environ.get("ARCHERO_OCR_TARGETS_FILE", "/run/secrets/targets.json"))
    roster_cache_path = Path(os.environ.get("ARCHERO_OCR_ROSTER_CACHE", str(targets_file.with_name("roster-cache.json"))))
    ui_root = Path(os.environ.get("ARCHERO_OCR_UI_ROOT", "/app/ocr/ui"))
    local_roster_path = Path(os.environ.get("ARCHERO_OCR_LOCAL_ROSTER", "/app/web/sample-data.js"))
    targets = load_targets(targets_file)
    screenshots_root.mkdir(parents=True, exist_ok=True)
    outbox_root.mkdir(parents=True, exist_ok=True)
    server = LocalOcrServer(
        (host, port),
        screenshots_root=screenshots_root,
        outbox_root=outbox_root,
        targets=targets,
        targets_file=targets_file,
        roster_cache_path=roster_cache_path,
        ui_root=ui_root,
        local_roster_path=local_roster_path,
        agent_version=os.environ.get("ARCHERO_AGENT_VERSION", "development"),
        public_port=public_port,
        public_host=public_host,
    )
    print(f"Archero OCR UI listening on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def _validate_date(value: str) -> None:
    if not DATE_PATTERN.fullmatch(value):
        raise LocalOcrError("date must use YYYY-MM-DD format")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise LocalOcrError("date is invalid") from exc
    if parsed.isoformat() != value:
        raise LocalOcrError("date is invalid")


def _validate_png(content: bytes) -> tuple[int, int]:
    if len(content) > MAX_IMAGE_BYTES:
        raise LocalOcrError("PNG file exceeds the 15 MB limit")
    if not content.startswith(PNG_SIGNATURE):
        raise LocalOcrError("only valid PNG screenshots are accepted")
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
    except (OSError, ValueError) as exc:
        raise LocalOcrError("uploaded PNG cannot be decoded") from exc
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise LocalOcrError("PNG dimensions exceed the 12 megapixel limit")
    return width, height


def _next_capture_index(directory: Path, prefix: str) -> int:
    indices = []
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)\.png$")
    for path in directory.glob(f"{prefix}-*.png"):
        match = pattern.fullmatch(path.name)
        if match:
            indices.append(int(match.group(1)))
    return max(indices, default=0) + 1


if __name__ == "__main__":
    raise SystemExit(main())
