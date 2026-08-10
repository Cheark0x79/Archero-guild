from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from archero_guild.ocr.service import _load_roster, scan_image


class EvaluationError(RuntimeError):
    pass


DEFAULT_FIELDS = {
    "guild-members": ("playerId", "name", "role", "power", "contribution7d", "bossAttacks", "lastActivityDays"),
    "guild-boss": ("rank", "name", "damage"),
}


def compare_rows(
    expected: list[dict[str, Any]],
    actual: list[dict[str, Any]],
    *,
    identity_field: str,
    fields: tuple[str, ...],
) -> dict[str, Any]:
    expected_by_key = {_key(row.get(identity_field)): row for row in expected if _key(row.get(identity_field))}
    actual_by_key = {_key(row.get(identity_field)): row for row in actual if _key(row.get(identity_field))}
    field_results: dict[str, dict[str, int | float]] = {}
    for field in fields:
        compared = exact = 0
        for key, expected_row in expected_by_key.items():
            if key not in actual_by_key:
                continue
            compared += 1
            if _normalized(expected_row.get(field)) == _normalized(actual_by_key[key].get(field)):
                exact += 1
        field_results[field] = {
            "compared": compared,
            "exact": exact,
            "accuracy": round(exact / compared, 4) if compared else 0,
        }
    matched = len(expected_by_key.keys() & actual_by_key.keys())
    return {
        "expectedRows": len(expected_by_key),
        "actualRows": len(actual_by_key),
        "matchedRows": matched,
        "rowRecall": round(matched / len(expected_by_key), 4) if expected_by_key else 0,
        "missingIdentities": sorted(expected_by_key.keys() - actual_by_key.keys()),
        "unexpectedIdentities": sorted(actual_by_key.keys() - expected_by_key.keys()),
        "fields": field_results,
    }


def evaluate_manifest(manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("version") != 1 or not isinstance(manifest.get("cases"), list):
        raise EvaluationError("manifest must contain version 1 and a cases array")
    root = manifest_path.parent
    results = []
    for case in manifest["cases"]:
        if not isinstance(case, dict):
            raise EvaluationError("every case must be an object")
        kind = str(case.get("kind") or "")
        if kind not in DEFAULT_FIELDS:
            raise EvaluationError(f"unsupported case kind: {kind}")
        expected = case.get("expectedRows")
        if not isinstance(expected, list) or any(not isinstance(row, dict) for row in expected):
            raise EvaluationError("expectedRows must be an array of objects")
        image = (root / str(case.get("image") or "")).resolve()
        roster_path = (root / str(case["roster"])).resolve() if case.get("roster") else None
        scan = scan_image(
            image,
            kind,
            include_podium=case.get("includePodium", True) is True,
            roster=_load_roster(roster_path),
        )
        identity = str(case.get("identityField") or ("playerId" if kind == "guild-members" else "rank"))
        fields = tuple(str(field) for field in case.get("fields", DEFAULT_FIELDS[kind]))
        results.append({
            "id": str(case.get("id") or image.name),
            "kind": kind,
            "image": str(image),
            "input": scan["input"],
            "quality": scan["quality"],
            **compare_rows(expected, scan["rows"], identity_field=identity, fields=fields),
        })
    total_expected = sum(item["expectedRows"] for item in results)
    total_matched = sum(item["matchedRows"] for item in results)
    return {
        "version": 1,
        "cases": results,
        "summary": {
            "caseCount": len(results),
            "expectedRows": total_expected,
            "matchedRows": total_matched,
            "rowRecall": round(total_matched / total_expected, 4) if total_expected else 0,
        },
    }


def _key(value: Any) -> str:
    return str(value).strip().casefold() if value is not None else ""


def _normalized(value: Any) -> Any:
    return value.strip().casefold() if isinstance(value, str) else value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate OCR against a private, unseen capture manifest.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    report = evaluate_manifest(args.manifest)
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
