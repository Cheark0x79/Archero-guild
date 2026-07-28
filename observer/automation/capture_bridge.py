from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path


class CaptureBridgeError(RuntimeError):
    pass


class CaptureBridgeClient:
    def __init__(
        self,
        bridge_dir: Path,
        *,
        serial: str | None = None,
        timeout_seconds: float = 20.0,
        poll_interval_seconds: float = 0.1,
        project_root: Path | None = None,
    ) -> None:
        self.bridge_dir = bridge_dir
        self.serial = serial
        self.timeout_seconds = timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.project_root = (project_root or Path.cwd()).resolve()

    def screenshot(self, output_path: Path) -> Path:
        destination = output_path.resolve()
        try:
            relative_destination = destination.relative_to(self.project_root)
        except ValueError as exc:
            raise CaptureBridgeError("capture destination must stay inside the project") from exc

        request_id = uuid.uuid4().hex
        requests_dir = self.bridge_dir / "requests"
        responses_dir = self.bridge_dir / "responses"
        requests_dir.mkdir(parents=True, exist_ok=True)
        responses_dir.mkdir(parents=True, exist_ok=True)
        request_path = requests_dir / f"{request_id}.json"
        response_path = responses_dir / f"{request_id}.json"

        request = {
            "version": 1,
            "id": request_id,
            "kind": _capture_kind_for_path(relative_destination),
            "output_path": relative_destination.as_posix(),
            "serial": self.serial,
        }
        _write_json_atomic(request_path, request)

        deadline = time.monotonic() + self.timeout_seconds
        try:
            while time.monotonic() < deadline:
                if response_path.exists():
                    response = _read_json(response_path)
                    if response.get("id") != request_id:
                        raise CaptureBridgeError("capture bridge returned a mismatched request id")
                    if response.get("ok") is not True:
                        message = response.get("error")
                        raise CaptureBridgeError(message if isinstance(message, str) else "capture bridge failed")
                    if not destination.is_file():
                        raise CaptureBridgeError("capture bridge reported success without a PNG file")
                    return output_path
                time.sleep(self.poll_interval_seconds)
        finally:
            request_path.unlink(missing_ok=True)
            response_path.unlink(missing_ok=True)

        raise CaptureBridgeError(
            "capture bridge timed out; verify that BlueStacks and the Windows capture agent are running"
        )


def capture_client_from_environment(serial: str | None = None) -> CaptureBridgeClient | None:
    configured = os.environ.get("ARCHERO_CAPTURE_BRIDGE_DIR")
    if not configured:
        return None

    timeout_text = os.environ.get("ARCHERO_CAPTURE_BRIDGE_TIMEOUT", "20")
    try:
        timeout_seconds = float(timeout_text)
    except ValueError as exc:
        raise CaptureBridgeError("ARCHERO_CAPTURE_BRIDGE_TIMEOUT must be a number") from exc
    if timeout_seconds <= 0 or timeout_seconds > 120:
        raise CaptureBridgeError("ARCHERO_CAPTURE_BRIDGE_TIMEOUT must be between 0 and 120 seconds")

    return CaptureBridgeClient(Path(configured), serial=serial, timeout_seconds=timeout_seconds)


def _read_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CaptureBridgeError("capture bridge returned an invalid response") from exc
    if not isinstance(value, dict):
        raise CaptureBridgeError("capture bridge response must be an object")
    return value


def _write_json_atomic(path: Path, value: dict[str, object]) -> None:
    temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(f"{json.dumps(value, separators=(',', ':'))}\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _capture_kind_for_path(path: Path) -> str:
    normalized = path.as_posix()
    if normalized.startswith("screenshots/quarantine/bridge-probe-"):
        return "bridge-probe"
    if "/guild/members-" in normalized:
        return "guild-members"
    if "/boss/boss-" in normalized:
        return "guild-boss"
    if "/boss/monster-invasion-" in normalized:
        return "monster-invasion"
    raise CaptureBridgeError("capture destination does not match a supported kind")
