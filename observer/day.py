from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence

from observer.capture import today_europe_paris
from observer.capture import _validate_capture_date as validate_capture_date
from observer.import_capture import ImportReport, import_capture_day


@dataclass(frozen=True)
class DailyRunReport:
    date: str
    import_report: ImportReport | None
    dry_run: bool


def run_day(
    capture_date: str | None = None,
    *,
    raw_root: Path = Path("screenshots/raw"),
    imports_root: Path = Path("data/imports"),
    sample_data_path: Path = Path("web/sample-data.js"),
    captured_at: str | None = None,
    update_front: bool = True,
    dry_run: bool = False,
) -> DailyRunReport:
    date_value = capture_date or today_europe_paris()
    validate_capture_date(date_value)

    if dry_run:
        return DailyRunReport(
            date=date_value,
            import_report=None,
            dry_run=True,
        )

    import_report = import_capture_day(
        date_value,
        raw_root=raw_root,
        imports_root=imports_root,
        sample_data_path=sample_data_path,
        captured_at=captured_at,
        update_front=update_front,
    )

    return DailyRunReport(
        date=date_value,
        import_report=import_report,
        dry_run=False,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Import already captured guild and boss screenshots for a day into the dashboard data."
    )
    parser.add_argument("date", nargs="?", help="Import date as YYYY-MM-DD. Defaults to today in Europe/Paris.")
    parser.add_argument("--raw-root", type=Path, default=Path("screenshots/raw"), help="Root raw screenshot directory.")
    parser.add_argument("--imports-root", type=Path, default=Path("data/imports"), help="Import reports directory.")
    parser.add_argument("--sample-data", type=Path, default=Path("web/sample-data.js"), help="Dashboard sample data file.")
    parser.add_argument("--captured-at", help="Import timestamp override, for deterministic backfills.")
    parser.add_argument("--no-front-update", action="store_true", help="Write the import report without updating web/sample-data.js.")
    parser.add_argument("--dry-run", action="store_true", help="Validate arguments and print the selected date without importing.")
    args = parser.parse_args(argv)

    try:
        report = run_day(
            args.date,
            raw_root=args.raw_root,
            imports_root=args.imports_root,
            sample_data_path=args.sample_data,
            captured_at=args.captured_at,
            update_front=not args.no_front_update,
            dry_run=args.dry_run,
        )
    except (FileNotFoundError, ValueError) as exc:
        parser.exit(1, f"error: {exc}\n")

    print(json.dumps(_report_payload(report), indent=2))
    return 0


def _report_payload(report: DailyRunReport) -> dict[str, object]:
    payload: dict[str, object] = {
        "date": report.date,
        "dry_run": report.dry_run,
    }
    if report.import_report is not None:
        payload["import"] = asdict(report.import_report)
    return payload


if __name__ == "__main__":
    raise SystemExit(main())
