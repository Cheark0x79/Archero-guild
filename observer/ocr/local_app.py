from __future__ import annotations

import base64
import binascii
import json
import os
import re
import threading
import urllib.parse
from datetime import date, datetime
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
)


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


class LocalOcrError(RuntimeError):
    pass


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
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", str(key)) or not isinstance(raw, dict):
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
    return targets


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
    return [
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
        raise LocalOcrError("select App test, preprod, or prod")
    target_url = _validated_target(url)
    token = ingestion_token.strip() or str(target.get("ingestionToken") or "")
    if len(token) < 16 or token.startswith(("generate-", "replace-")):
        raise LocalOcrError("enter a real ingestion token containing at least 16 characters")
    target["url"] = target_url
    target["ingestionToken"] = token
    target["configured"] = True
    serialized = {
        target_key: {
            "label": item["label"],
            "mode": item["mode"],
            **({"url": item["url"], "ingestionToken": item["ingestionToken"]} if item["mode"] == "remote" else {}),
            **({"cfAccessClientId": item["cfAccessClientId"]} if item.get("cfAccessClientId") else {}),
            **({"cfAccessClientSecret": item["cfAccessClientSecret"]} if item.get("cfAccessClientSecret") else {}),
        }
        for target_key, item in targets.items()
    }
    try:
        path.write_text(json.dumps(serialized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        raise LocalOcrError(f"could not save OCR destinations: {exc}") from exc
    return target


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
                self._send_json({
                    "ok": True,
                    "service": "archero-local-ocr",
                    "busy": JOB_LOCK.locked(),
                    "agentVersion": self.app.agent_version,
                    "targets": configured_target_public(self.app.targets),
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
                self._send_json({
                    "ok": True,
                    "batch": json.loads(batch_path.read_text(encoding="utf-8")),
                    "corrections": corrections,
                })
                return
            if parsed.path == "/api/missing-members":
                self._send_missing_members(parsed)
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
            removed = clear_reviewed_data(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
                capture_date,
            )
        finally:
            JOB_LOCK.release()
        self._send_json({
            "ok": True,
            "files": saved,
            "replacedSession": True,
            "reviewedDataInvalidated": removed,
        }, HTTPStatus.CREATED)

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
            removed = clear_reviewed_data(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
                capture_date,
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
        target_key = str(payload.get("target") or "") if publish else "local"
        _validate_date(capture_date)
        target = self.app.targets.get(target_key)
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
            member_paths: list[Path] | None = None
            boss_paths: list[Path] | None = None
            if not publish:
                member_paths, boss_paths = selected_capture_paths(
                    self.app.screenshots_root,
                    capture_date,
                    payload.get("images"),
                )
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
                result = run_day(
                    capture_date=capture_date,
                    screenshots_root=self.app.screenshots_root,
                    output=self.app.outbox_root / f"{capture_date}.json",
                    target=target["url"],
                    token=target["ingestionToken"],
                    agent_version=self.app.agent_version,
                    publish=publish,
                    timeout=180,
                    access_client_id=target["cfAccessClientId"],
                    access_client_secret=target["cfAccessClientSecret"],
                )
            if not publish:
                self._corrections_path(capture_date).unlink(missing_ok=True)
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "result": result})

    def _scan_roster(self):
        try:
            target_key, target = self._preferred_roster_target()
            roster = fetch_roster(
                target["url"],
                target["ingestionToken"],
                timeout=15,
                access_client_id=target["cfAccessClientId"],
                access_client_secret=target["cfAccessClientSecret"],
            )
            if roster:
                return roster, {
                    "type": "database",
                    "target": target_key,
                    "label": target["label"],
                }
        except (LocalOcrError, RemoteOcrError):
            pass
        roster = read_roster_entries(self.app.local_roster_path)
        if not roster:
            raise LocalOcrError(f"OCR roster is empty: {self.app.local_roster_path}")
        return roster, {
            "type": "local-fallback",
            "label": "local fallback roster",
        }

    def _preflight_publish(self, payload: dict[str, Any]) -> None:
        capture_date = str(payload.get("date") or "")
        target_key = str(payload.get("target") or "")
        _validate_date(capture_date)
        target = self.app.targets.get(target_key)
        if target is None or target["mode"] != "remote" or not target["configured"]:
            raise LocalOcrError("select a configured remote destination")
        batch_path = self.app.outbox_root / f"{capture_date}.json"
        if not batch_path.exists():
            raise LocalOcrError("no reviewed OCR batch exists for this date")
        batch = json.loads(batch_path.read_text(encoding="utf-8"))
        if not isinstance(batch, dict) or batch.get("captureDate") != capture_date:
            raise LocalOcrError("the reviewed OCR batch does not match the selected date")
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
            removed = clear_reviewed_data(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
                capture_date,
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
            batch, corrections = apply_batch_edit(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
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
            batch, corrections = delete_batch_row(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
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
            batch, corrections = add_batch_row(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
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
            removed = clear_reviewed_data(
                self.app.outbox_root / f"{capture_date}.json",
                self._corrections_path(capture_date),
                capture_date,
            )
        finally:
            JOB_LOCK.release()
        self._send_json({"ok": True, "removed": removed})

    def _corrections_path(self, capture_date: str) -> Path:
        return self.app.outbox_root / "corrections" / f"{capture_date}.json"

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
        if source_kinds != {"guild-members"}:
            self._send_json({"ok": True, "members": [], "target": None})
            return
        target_key, target = self._preferred_roster_target()
        roster = fetch_roster(
            target["url"],
            target["ingestionToken"],
            timeout=15,
            access_client_id=target["cfAccessClientId"],
            access_client_secret=target["cfAccessClientSecret"],
        )
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
            "target": {"key": target_key, "label": target["label"]},
        })

    def _preferred_roster_target(self) -> tuple[str, dict[str, Any]]:
        preferred = self.app.targets.get("app-test")
        if preferred and preferred["mode"] == "remote" and preferred["configured"]:
            return "app-test", preferred
        for key, target in self.app.targets.items():
            if target["mode"] == "remote" and target["configured"]:
                return key, target
        raise LocalOcrError("configure a remote destination to compare missing members")

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
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
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
        ui_root: Path,
        local_roster_path: Path,
        agent_version: str,
        public_port: int,
    ) -> None:
        super().__init__(address, LocalOcrHandler)
        self.screenshots_root = screenshots_root
        self.outbox_root = outbox_root
        self.targets = targets
        self.targets_file = targets_file
        self.ui_root = ui_root
        self.local_roster_path = local_roster_path
        self.agent_version = agent_version
        self.public_port = public_port


def main() -> int:
    host = os.environ.get("ARCHERO_OCR_UI_HOST", "127.0.0.1")
    port = int(os.environ.get("ARCHERO_OCR_UI_PORT", "5190"))
    screenshots_root = Path(os.environ.get("ARCHERO_SCREENSHOTS_ROOT", "/captures"))
    outbox_root = Path(os.environ.get("ARCHERO_OUTBOX_ROOT", "/outbox"))
    targets_file = Path(os.environ.get("ARCHERO_OCR_TARGETS_FILE", "/run/secrets/targets.json"))
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
        ui_root=ui_root,
        local_roster_path=local_roster_path,
        agent_version=os.environ.get("ARCHERO_AGENT_VERSION", "development"),
        public_port=port,
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
