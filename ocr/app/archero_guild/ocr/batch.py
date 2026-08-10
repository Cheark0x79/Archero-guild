from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from archero_guild.ocr.service import _load_roster, scan_image


def build_import_batch(
    scans: list[tuple[str, Path, dict[str, Any]]],
    *,
    capture_date: str,
    agent_version: str,
    generated_at: str | None = None,
) -> dict[str, Any]:
    source_images = []
    members: list[dict[str, Any]] = []
    bosses: list[dict[str, Any]] = []
    warnings: list[str] = []
    expected = useful = complete = 0

    for kind, path, result in scans:
        quality = result["quality"]
        expected += int(quality.get("expectedRows") or 0)
        useful += int(quality.get("usefulRows") or 0)
        complete += int(quality.get("completeRows") or 0)
        warnings.extend(str(warning) for warning in quality.get("warnings", []))
        source_images.append(
            {
                "kind": kind,
                "sha256": _sha256(path),
                "width": result["input"]["width"],
                "height": result["input"]["height"],
                "detectedRows": int(quality.get("expectedRows") or result["detection"]["rowCount"]),
                "sourceName": path.name,
            }
        )
        if kind == "guild-members":
            members.extend(_member_contract(row) for row in result["rows"])
        else:
            bosses.extend(_boss_contract(row) for row in result["rows"])

    members = _dedupe(members, _member_identity_key)
    bosses = _dedupe(
        bosses,
        lambda row: (
            f"rank:{row['rank']}"
            if row.get("rank") is not None
            else f"unranked:{row.get('source')}:{row.get('rowIndex')}"
        ),
    )
    coverage = useful / expected if expected else 0
    completeness = complete / expected if expected else 0
    batch = {
        "schemaVersion": 1,
        "captureDate": capture_date,
        "generatedAt": generated_at or datetime.now(ZoneInfo("Europe/Paris")).isoformat(),
        "agentVersion": agent_version,
        "idempotencyKey": "",
        "sourceImages": source_images,
        "members": members,
        "bossRankings": bosses,
        "quality": {
            "status": "pass" if expected and coverage == 1 and completeness == 1 else "review",
            "coverage": round(coverage, 6),
            "completeness": round(completeness, 6),
            "warnings": list(dict.fromkeys(warnings)),
        },
    }
    digest = hashlib.sha256(_canonical_json({**batch, "idempotencyKey": ""})).hexdigest()
    batch["idempotencyKey"] = f"{capture_date}:{digest}"
    return batch


def _member_contract(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: row.get(key)
        for key in (
            "playerId",
            "name",
            "role",
            "power",
            "powerText",
            "contribution7d",
            "bossAttacks",
            "lastActivityDays",
            "activityText",
            "roleText",
            "rawActivity",
            "rawRole",
            "source",
            "rawName",
            "matchScore",
        )
    }


def _boss_contract(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "playerId": row.get("playerId"),
        "name": row.get("name") or row.get("rawName") or "Unknown",
        "rawName": row.get("rawName"),
        "rank": row.get("rank"),
        "damageText": row.get("damageText"),
        "damage": row.get("damage"),
        "area": row.get("area") or ("podium" if int(row.get("rank") or 99) <= 3 else "list"),
        "rowIndex": int(row.get("rowIndex") or 0),
        "source": row.get("source") or "unknown",
    }


def _dedupe(rows: list[dict[str, Any]], key) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_key = key(row)
        existing = selected.get(row_key)
        if existing is None or _row_quality(row) > _row_quality(existing):
            selected[row_key] = row
    return list(selected.values())


def _member_identity_key(row: dict[str, Any]) -> str:
    if row.get("playerId"):
        return f"id:{row['playerId']}"
    observed_name = row.get("name") or row.get("rawName")
    if isinstance(observed_name, str) and observed_name.strip():
        return f"name:{observed_name.strip().casefold()}"
    return f"unresolved:{row.get('source') or 'unknown'}"


def _row_quality(row: dict[str, Any]) -> tuple[int, int, float]:
    complete = sum(value is not None and value != "" for value in row.values())
    return (1 if row.get("playerId") else 0, complete, float(row.get("matchScore") or 0))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a versioned import batch from local screenshots.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--roster", type=Path, required=True)
    parser.add_argument("--member", action="append", type=Path, default=[])
    parser.add_argument("--boss", action="append", type=Path, default=[])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--agent-version", default=os.environ.get("ARCHERO_AGENT_VERSION", "development"))
    args = parser.parse_args(argv)
    if not args.member and not args.boss:
        parser.error("at least one --member or --boss screenshot is required")

    roster = _load_roster(args.roster)
    scans: list[tuple[str, Path, dict[str, Any]]] = []
    for image in args.member:
        scans.append(("guild-members", image, scan_image(image, "guild-members", roster=roster)))
    for index, image in enumerate(args.boss):
        scans.append(
            (
                "guild-boss",
                image,
                scan_image(image, "guild-boss", roster=roster, include_podium=index == 0),
            )
        )
    batch = build_import_batch(
        scans,
        capture_date=args.date,
        agent_version=args.agent_version,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "quality": batch["quality"], "idempotencyKey": batch["idempotencyKey"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
