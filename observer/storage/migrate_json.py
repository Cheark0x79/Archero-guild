from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence

from observer.import_capture import (
    ImportedScreenshot,
    ImportReport,
    validate_capture_date,
    validate_extracted_import,
)
from observer.import_capture import read_roster_entries
from observer.pipeline.guild_boss import (
    ExtractedBossRanking,
    GuildBossDetectionError,
    extract_boss_rankings_from_screenshots,
)
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics, extract_member_metrics_from_screenshots
from observer.storage.persistence import database_url_from_env, persist_import_report


@dataclass(frozen=True)
class MigratedImport:
    date: str
    report_path: str
    member_screenshots: int
    boss_screenshots: int
    member_metrics: int
    boss_rankings: int
    persisted: bool
    warnings: list[str]


def migrate_import_reports(
    *,
    dsn: str | None = None,
    imports_root: Path = Path("data/imports"),
    sample_data_path: Path = Path("web/sample-data.js"),
    dates: Sequence[str] | None = None,
    apply_schema: bool = False,
    schema_path: Path = Path("observer/storage/schema.sql"),
    dry_run: bool = False,
    with_ocr: bool = False,
    strict: bool = False,
) -> list[MigratedImport]:
    selected_dates = list(dates or [])
    for selected_date in selected_dates:
        validate_capture_date(selected_date)

    database_url = dsn or database_url_from_env()
    if not dry_run and not database_url:
        raise ValueError("ARCHERO_DATABASE_URL or DATABASE_URL is required unless --dry-run is used")

    if not imports_root.exists():
        raise FileNotFoundError(imports_root)

    if apply_schema and not dry_run:
        _apply_schema(database_url, schema_path)

    roster = read_roster_entries(sample_data_path) if sample_data_path.exists() else []
    reports = _report_paths(imports_root, selected_dates)
    migrated: list[MigratedImport] = []
    for report_path in reports:
        report = load_import_report(report_path)
        warnings: list[str] = []
        member_paths = _existing_paths(report.member_screenshots, strict=strict, warnings=warnings)
        boss_paths = _existing_paths(report.boss_screenshots, strict=strict, warnings=warnings)

        if with_ocr:
            member_metrics = _extract_member_metrics(member_paths, roster, sample_data_path.exists(), strict=strict, warnings=warnings)
            boss_rankings = _extract_boss_rankings(boss_paths, roster, strict=strict, warnings=warnings)
        else:
            member_metrics = []
            boss_rankings = []
            if member_paths or boss_paths:
                warnings.append("OCR skipped; rerun with --with-ocr to migrate extracted metrics and boss rankings")
        daily_boss_rankings = {report.date: boss_rankings} if boss_rankings else {}

        if with_ocr:
            quality = validate_extracted_import(
                member_screenshots=report.member_screenshots,
                boss_screenshots=report.boss_screenshots,
                extracted_metrics=member_metrics,
                boss_rankings=boss_rankings,
                expected_member_count=len(roster),
            )
            warnings.extend(str(item) for item in quality.get("warnings", []))

        if not dry_run:
            persist_import_report(
                database_url,
                report,
                roster=roster,
                extracted_metrics=member_metrics,
                daily_boss_rankings=daily_boss_rankings,
            )

        migrated.append(
            MigratedImport(
                date=report.date,
                report_path=str(report_path),
                member_screenshots=len(member_paths),
                boss_screenshots=len(boss_paths),
                member_metrics=len(member_metrics),
                boss_rankings=len(boss_rankings),
                persisted=not dry_run,
                warnings=warnings,
            )
        )

    return migrated


def load_import_report(path: Path) -> ImportReport:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return ImportReport(
        date=payload["date"],
        captured_at=payload["captured_at"],
        raw_dir=payload["raw_dir"],
        member_screenshots=[ImportedScreenshot(**item) for item in payload.get("member_screenshots", [])],
        boss_screenshots=[ImportedScreenshot(**item) for item in payload.get("boss_screenshots", [])],
        detected_member_rows=payload.get("detected_member_rows", 0),
        detected_boss_rows=payload.get("detected_boss_rows", 0),
        extracted_member_metrics=payload.get("extracted_member_metrics", 0),
        report_path=payload.get("report_path", str(path)),
        front_updated=payload.get("front_updated", False),
    )


def _report_paths(imports_root: Path, dates: Sequence[str]) -> list[Path]:
    if dates:
        paths = [imports_root / f"{date}.json" for date in dates]
    else:
        paths = sorted(imports_root.glob("*.json"))
    missing = [path for path in paths if not path.exists()]
    if missing:
        raise FileNotFoundError(", ".join(str(path) for path in missing))
    return paths


def _existing_paths(screenshots: Sequence[ImportedScreenshot], *, strict: bool, warnings: list[str]) -> list[Path]:
    paths: list[Path] = []
    missing: list[str] = []
    for screenshot in screenshots:
        path = Path(screenshot.path)
        if path.exists():
            paths.append(path)
        else:
            missing.append(str(path))
    if strict and missing:
        raise FileNotFoundError(", ".join(missing))
    if missing:
        warnings.append(f"{len(missing)} screenshot(s) missing")
    return paths


def _extract_member_metrics(
    paths: list[Path],
    roster: Sequence[object],
    has_sample_data: bool,
    *,
    strict: bool,
    warnings: list[str],
) -> list[ExtractedMemberMetrics]:
    if not paths or not has_sample_data:
        if paths and not has_sample_data:
            warnings.append("member OCR skipped because sample data roster is missing")
        return []
    try:
        return extract_member_metrics_from_screenshots(paths, list(roster))
    except Exception as exc:
        if strict:
            raise
        warnings.append(f"member OCR skipped: {exc}")
        return []


def _extract_boss_rankings(
    paths: list[Path],
    roster: Sequence[object],
    *,
    strict: bool,
    warnings: list[str],
) -> list[ExtractedBossRanking]:
    if not paths:
        return []
    try:
        return extract_boss_rankings_from_screenshots(paths, roster)
    except (GuildBossDetectionError, OSError) as exc:
        if strict:
            raise
        warnings.append(f"boss OCR skipped: {exc}")
        return []


def _apply_schema(dsn: str, schema_path: Path) -> None:
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover - depends on local runtime
        raise RuntimeError("psycopg is required to apply the PostgreSQL schema") from exc

    schema = schema_path.read_text(encoding="utf-8")
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(schema)
        connection.commit()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate JSON import reports into PostgreSQL.")
    parser.add_argument("--dsn", default=database_url_from_env(), help="PostgreSQL DSN. Defaults to ARCHERO_DATABASE_URL or DATABASE_URL.")
    parser.add_argument("--imports-root", type=Path, default=Path("data/imports"))
    parser.add_argument("--sample-data", type=Path, default=Path("web/sample-data.js"))
    parser.add_argument("--date", action="append", default=[], help="Import only this YYYY-MM-DD report. Can be repeated.")
    parser.add_argument("--apply-schema", action="store_true", help="Apply observer/storage/schema.sql before migrating.")
    parser.add_argument("--schema", type=Path, default=Path("observer/storage/schema.sql"))
    parser.add_argument("--dry-run", action="store_true", help="Read reports without writing to PostgreSQL.")
    parser.add_argument("--with-ocr", action="store_true", help="Re-run OCR on referenced screenshots to migrate extracted metrics and boss rankings.")
    parser.add_argument("--strict", action="store_true", help="Fail on missing screenshots or extraction errors.")
    args = parser.parse_args(argv)

    try:
        migrated = migrate_import_reports(
            dsn=args.dsn,
            imports_root=args.imports_root,
            sample_data_path=args.sample_data,
            dates=args.date,
            apply_schema=args.apply_schema,
            schema_path=args.schema,
            dry_run=args.dry_run,
            with_ocr=args.with_ocr,
            strict=args.strict,
        )
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"error: {exc}\n")

    print(json.dumps({"imports": [asdict(item) for item in migrated]}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
