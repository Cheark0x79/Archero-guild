from __future__ import annotations

import ipaddress
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class PublishError(RuntimeError):
    pass


def check_target(
    target: str,
    token: str,
    *,
    timeout: float = 15,
) -> dict[str, Any]:
    base_url = _validated_target(target)
    request = urllib.request.Request(
        f"{base_url}/api/v1/imports/roster",
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "archero-ocr-agent/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read(2 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        raise PublishError(f"{request.full_url} returned HTTP {exc.code}: {detail}") from exc
    except (TimeoutError, urllib.error.URLError) as exc:
        if isinstance(exc, TimeoutError):
            raise PublishError(f"{request.full_url} timed out after {timeout:g} seconds") from exc
        raise PublishError(f"could not reach {request.full_url}: {exc.reason}") from exc
    if len(response_body) > 2 * 1024 * 1024:
        raise PublishError("destination readiness response is too large")
    try:
        result = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublishError("destination readiness check returned invalid JSON") from exc
    if not isinstance(result, dict) or not isinstance(result.get("data"), list):
        raise PublishError("destination readiness check returned an invalid roster")
    source = result.get("meta", {}).get("source") if isinstance(result.get("meta"), dict) else None
    if source != "database":
        raise PublishError("destination API is reachable but its PostgreSQL database is unavailable")
    return {
        "reachable": True,
        "database": True,
        "rosterCount": len(result["data"]),
    }


def publish_batch(
    batch: dict[str, Any],
    *,
    target: str,
    token: str,
    validate_only: bool = False,
    timeout: float = 30,
    import_timeout: float | None = None,
) -> dict[str, Any]:
    base_url = _validated_target(target)
    validation = _post_json(
        f"{base_url}/api/v1/imports/validate",
        batch,
        token=token,
        timeout=timeout,
    )
    validation_data = validation.get("data", {})
    if not validation_data.get("publishable"):
        errors = validation_data.get("errors")
        if isinstance(errors, list) and errors:
            detail = "; ".join(str(error) for error in errors[:5])
            raise PublishError(f"destination validation refused the OCR batch: {detail}")
        raise PublishError(
            "destination accepted the OCR schema but marked the batch non-publishable; "
            "the destination may need the combined Members + Boss import update"
        )
    if validate_only:
        return {"validated": True, "published": False, "validation": validation_data}
    effective_import_timeout = import_timeout if import_timeout is not None else max(timeout, 120)
    published = _post_json(
        f"{base_url}/api/v1/imports",
        batch,
        token=token,
        timeout=effective_import_timeout,
    )
    return {"validated": True, "published": True, "import": published.get("data", {})}


def fetch_import_history(
    target: str,
    token: str,
    *,
    limit: int = 10,
    timeout: float = 15,
) -> list[dict[str, Any]]:
    if not 1 <= limit <= 50:
        raise PublishError("history limit must be between 1 and 50")
    base_url = _validated_target(target)
    result = _get_json(
        f"{base_url}/api/v1/imports/history?limit={limit}",
        token=token,
        timeout=timeout,
    )
    history = result.get("data")
    if not isinstance(history, list) or any(not isinstance(item, dict) for item in history):
        raise PublishError("destination returned an invalid import history")
    return history


def _get_json(
    url: str,
    *,
    token: str,
    timeout: float,
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "archero-ocr-agent/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read(2 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        raise PublishError(f"{url} returned HTTP {exc.code}: {detail}") from exc
    except (TimeoutError, urllib.error.URLError) as exc:
        if isinstance(exc, TimeoutError):
            raise PublishError(f"{url} timed out after {timeout:g} seconds") from exc
        raise PublishError(f"could not reach {url}: {exc.reason}") from exc
    if len(response_body) > 2 * 1024 * 1024:
        raise PublishError("destination history response is too large")
    try:
        result = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublishError("destination history returned invalid JSON") from exc
    if not isinstance(result, dict):
        raise PublishError("destination history returned an invalid response")
    return result


def _post_json(
    url: str,
    payload: dict[str, Any],
    *,
    token: str,
    timeout: float,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "User-Agent": "archero-ocr-agent/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read(2 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        raise PublishError(f"{url} returned HTTP {exc.code}: {detail}") from exc
    except (TimeoutError, urllib.error.URLError) as exc:
        if isinstance(exc, TimeoutError):
            raise PublishError(f"{url} timed out after {timeout:g} seconds") from exc
        raise PublishError(f"could not reach {url}: {exc.reason}") from exc
    if len(response_body) > 2 * 1024 * 1024:
        raise PublishError("production response is too large")
    result = json.loads(response_body.decode("utf-8"))
    if not isinstance(result, dict):
        raise PublishError("production returned an invalid JSON response")
    return result


def _validated_target(value: str) -> str:
    target = value.rstrip("/")
    parsed = urllib.parse.urlparse(target)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise PublishError("target must be an absolute HTTP(S) URL")
    if parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment:
        raise PublishError("target must be the server origin only, without /dashboard, query, or fragment")
    if parsed.scheme != "https" and not _is_private_http_host(parsed.hostname):
        raise PublishError("HTTP targets must use localhost or a private LAN IP; public targets require HTTPS")
    return f"{parsed.scheme}://{parsed.netloc}"


def _is_private_http_host(hostname: str | None) -> bool:
    if hostname in {"localhost"}:
        return True
    try:
        address = ipaddress.ip_address(hostname or "")
    except ValueError:
        return False
    return address.is_private or address.is_loopback or address.is_link_local
