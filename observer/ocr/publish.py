from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


class PublishError(RuntimeError):
    pass


def publish_batch(
    batch: dict[str, Any],
    *,
    target: str,
    token: str,
    validate_only: bool = False,
    timeout: float = 30,
) -> dict[str, Any]:
    base_url = _validated_target(target)
    validation = _post_json(f"{base_url}/api/v1/imports/validate", batch, token=token, timeout=timeout)
    validation_data = validation.get("data", {})
    if not validation_data.get("publishable"):
        raise PublishError("production validation refused the OCR batch")
    if validate_only:
        return {"validated": True, "published": False, "validation": validation_data}
    published = _post_json(f"{base_url}/api/v1/imports", batch, token=token, timeout=timeout)
    return {"validated": True, "published": True, "import": published.get("data", {})}


def _post_json(url: str, payload: dict[str, Any], *, token: str, timeout: float) -> dict[str, Any]:
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
    except urllib.error.URLError as exc:
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
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise PublishError("remote publication requires HTTPS")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate and publish an OCR batch over HTTPS.")
    parser.add_argument("batch", type=Path)
    parser.add_argument("--target", required=True)
    parser.add_argument("--token", default=os.environ.get("ARCHERO_INGESTION_TOKEN"))
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--timeout", type=float, default=30)
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
            ),
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
