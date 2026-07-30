from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from observer.ocr.batch import build_import_batch
from observer.ocr.publish import (
    PublishError,
    _validated_target,
    cloudflare_access_headers,
    publish_batch,
)
from observer.ocr.service import _load_roster, scan_image
from observer.pipeline.guild_member_ocr import RosterEntry


class RemoteOcrError(RuntimeError):
    pass


def fetch_roster(
    target: str,
    token: str,
    *,
    timeout: float = 30,
    access_client_id: str | None = None,
    access_client_secret: str | None = None,
) -> list[RosterEntry]:
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
            body = response.read(1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        raise RemoteOcrError(f"roster endpoint returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RemoteOcrError(f"could not fetch the remote roster: {exc.reason}") from exc
    if len(body) > 1024 * 1024:
        raise RemoteOcrError("remote roster response is too large")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RemoteOcrError("remote roster returned invalid JSON") from exc
    return _roster_entries(payload.get("data") if isinstance(payload, dict) else payload)


def build_day_batch(
    *,
    capture_date: str,
    screenshots_root: Path,
    roster: list[RosterEntry],
    agent_version: str,
    member_paths: list[Path] | None = None,
    boss_paths: list[Path] | None = None,
) -> dict[str, Any]:
    day_root = screenshots_root / capture_date
    member_paths = sorted(member_paths) if member_paths is not None else sorted((day_root / "guild").glob("*.png"))
    boss_paths = sorted(boss_paths) if boss_paths is not None else sorted((day_root / "boss").glob("*.png"))
    if not member_paths and not boss_paths:
        raise RemoteOcrError(f"no PNG screenshots found below {day_root}")

    scans: list[tuple[str, Path, dict[str, Any]]] = []
    for image in member_paths:
        scans.append(("guild-members", image, scan_image(image, "guild-members", roster=roster)))
    for index, image in enumerate(boss_paths):
        scans.append(
            (
                "guild-boss",
                image,
                scan_image(image, "guild-boss", roster=roster, include_podium=index == 0),
            )
        )
    return build_import_batch(
        scans,
        capture_date=capture_date,
        agent_version=agent_version,
    )


def run_day(
    *,
    capture_date: str,
    screenshots_root: Path,
    output: Path,
    target: str,
    token: str,
    agent_version: str,
    publish: bool,
    roster_path: Path | None = None,
    roster: list[RosterEntry] | None = None,
    validate_remote: bool = True,
    member_paths: list[Path] | None = None,
    boss_paths: list[Path] | None = None,
    timeout: float = 30,
    access_client_id: str | None = None,
    access_client_secret: str | None = None,
) -> dict[str, Any]:
    if publish:
        batch = _read_reviewed_batch(output, capture_date)
        result = publish_batch(
            batch,
            target=target,
            token=token,
            validate_only=False,
            timeout=min(timeout, 30),
            import_timeout=timeout,
            access_client_id=access_client_id,
            access_client_secret=access_client_secret,
        )
        return {
            "captureDate": capture_date,
            "output": str(output),
            "quality": batch["quality"],
            **result,
        }

    selected_roster = roster
    if selected_roster is None:
        selected_roster = _load_roster(roster_path) if roster_path is not None else fetch_roster(
            target,
            token,
            timeout=timeout,
            access_client_id=access_client_id,
            access_client_secret=access_client_secret,
        )
    if not selected_roster:
        raise RemoteOcrError("the OCR roster is empty")
    batch = build_day_batch(
        capture_date=capture_date,
        screenshots_root=screenshots_root,
        roster=selected_roster,
        agent_version=agent_version,
        member_paths=member_paths,
        boss_paths=boss_paths,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not validate_remote:
        return {
            "captureDate": capture_date,
            "output": str(output),
            "quality": batch["quality"],
            "validated": False,
            "validationMode": "local",
        }
    result = publish_batch(
        batch,
        target=target,
        token=token,
        validate_only=True,
        timeout=timeout,
        access_client_id=access_client_id,
        access_client_secret=access_client_secret,
    )
    return {
        "captureDate": capture_date,
        "output": str(output),
        "quality": batch["quality"],
        **result,
    }


def _read_reviewed_batch(path: Path, capture_date: str) -> dict[str, Any]:
    if not path.exists():
        raise RemoteOcrError(
            f"{path} does not exist; run validation without --publish and review the generated batch first"
        )
    try:
        batch = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RemoteOcrError(f"{path} is not a valid OCR batch") from exc
    if not isinstance(batch, dict) or batch.get("captureDate") != capture_date:
        raise RemoteOcrError(f"{path} does not contain capture date {capture_date}")
    if not isinstance(batch.get("quality"), dict):
        raise RemoteOcrError(f"{path} does not contain OCR quality metadata")
    return batch


def _roster_entries(value: object) -> list[RosterEntry]:
    if not isinstance(value, list):
        raise RemoteOcrError("remote roster must be an array")
    entries: list[RosterEntry] = []
    for row in value:
        if not isinstance(row, dict) or not row.get("playerId") or not row.get("name"):
            continue
        power = row.get("power")
        if power is None and isinstance(row.get("metrics"), dict):
            power = row["metrics"].get("power")
        entries.append(
            RosterEntry(
                player_id=str(row["playerId"]),
                name=str(row["name"]),
                power_hint=int(power) if isinstance(power, int) else None,
            )
        )
    return entries


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scan one local capture day, validate it remotely, and optionally publish it."
    )
    parser.add_argument("--date", required=True, help="Capture date in YYYY-MM-DD format.")
    parser.add_argument(
        "--screenshots-root",
        type=Path,
        default=Path(os.environ.get("ARCHERO_SCREENSHOTS_ROOT", "/captures")),
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--roster", type=Path, help="Optional local roster JSON; otherwise fetch it from the target.")
    parser.add_argument("--target", default=os.environ.get("ARCHERO_TARGET_URL"))
    parser.add_argument("--token", default=os.environ.get("ARCHERO_INGESTION_TOKEN"))
    parser.add_argument("--agent-version", default=os.environ.get("ARCHERO_AGENT_VERSION", "development"))
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish the already reviewed outbox JSON. Without this option, scan and validate only.",
    )
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--cf-access-client-id", default=os.environ.get("CF_ACCESS_CLIENT_ID"))
    parser.add_argument("--cf-access-client-secret", default=os.environ.get("CF_ACCESS_CLIENT_SECRET"))
    args = parser.parse_args(argv)
    if not args.target:
        parser.error("--target or ARCHERO_TARGET_URL is required")
    if not args.token:
        parser.error("--token or ARCHERO_INGESTION_TOKEN is required")
    output = args.output or Path("/outbox") / f"{args.date}.json"
    try:
        result = run_day(
            capture_date=args.date,
            screenshots_root=args.screenshots_root,
            output=output,
            target=args.target,
            token=args.token,
            agent_version=args.agent_version,
            publish=args.publish,
            roster_path=args.roster,
            timeout=args.timeout,
            access_client_id=args.cf_access_client_id,
            access_client_secret=args.cf_access_client_secret,
        )
    except (OSError, RemoteOcrError, PublishError, ValueError) as exc:
        parser.exit(1, f"error: {exc}\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
