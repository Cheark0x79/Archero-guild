from __future__ import annotations

import argparse
import ipaddress
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


class PublishError(RuntimeError):
    pass


def check_target(
    target: str,
    token: str,
    *,
    timeout: float = 15,
    access_client_id: str | None = None,
    access_client_secret: str | None = None,
) -> dict[str, Any]:
    base_url = _validated_target(target)
    request = urllib.request.Request(
        f"{base_url}/api/v1/imports/roster",
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "archero-ocr-agent/1",
            **cloudflare_access_headers(access_client_id, access_client_secret),
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
    access_client_id: str | None = None,
    access_client_secret: str | None = None,
) -> dict[str, Any]:
    base_url = _validated_target(target)
    access_headers = cloudflare_access_headers(access_client_id, access_client_secret)
    validation = _post_json(
        f"{base_url}/api/v1/imports/validate",
        batch,
        token=token,
        timeout=timeout,
        extra_headers=access_headers,
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
        extra_headers=access_headers,
    )
    return {"validated": True, "published": True, "import": published.get("data", {})}


def _post_json(
    url: str,
    payload: dict[str, Any],
    *,
    token: str,
    timeout: float,
    extra_headers: dict[str, str] | None = None,
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
            **(extra_headers or {}),
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


def cloudflare_access_headers(client_id: str | None, client_secret: str | None) -> dict[str, str]:
    client_id = (client_id or "").strip()
    client_secret = (client_secret or "").strip()
    if bool(client_id) != bool(client_secret):
        raise PublishError("Cloudflare Access client ID and secret must be configured together")
    if not client_id:
        return {}
    return {
        "CF-Access-Client-Id": client_id,
        "CF-Access-Client-Secret": client_secret,
    }


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate and publish an OCR batch over HTTPS.")
    parser.add_argument("batch", type=Path)
    parser.add_argument("--target", required=True)
    parser.add_argument("--token", default=os.environ.get("ARCHERO_INGESTION_TOKEN"))
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--cf-access-client-id", default=os.environ.get("CF_ACCESS_CLIENT_ID"))
    parser.add_argument("--cf-access-client-secret", default=os.environ.get("CF_ACCESS_CLIENT_SECRET"))
    args = parser.parse_args(argv)
    if not args.token:
        parser.error("--token or ARCHERO_INGESTION_TOKEN is required")
    batch = json.loads(args.batch.read_text(encoding="utf-8"))
    print(
        json.dumps(
            publish_batch(
                batch,
                target=args.target,
                token=args.token,
                validate_only=args.validate_only,
                timeout=args.timeout,
                access_client_id=args.cf_access_client_id,
                access_client_secret=args.cf_access_client_secret,
            ),
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
