from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol, Sequence
from zoneinfo import ZoneInfo

from observer.automation.adb import AdbClient


CAPTURE_KINDS = (
    "guild-members",
    "guild-boss",
    "monster-invasion",
)

_CAPTURE_NAME_PATTERN = re.compile(r"^(?P<kind>[a-z0-9-]+)-(?P<index>\d{3})\.png$")
_NESTED_CAPTURE_NAME_PATTERN = re.compile(r"^(?P<name>[a-z0-9-]+)-(?P<index>\d{3})\.png$")
_CAPTURE_LAYOUT = {
    "guild-members": ("guild", "members"),
    "guild-boss": ("boss", "boss"),
    "monster-invasion": ("boss", "monster-invasion"),
}


class ScreenshotClient(Protocol):
    def screenshot(self, output_path: Path) -> Path:
        pass


@dataclass(frozen=True)
class CaptureResult:
    path: Path
    kind: str
    capture_date: str
    index: int


def capture_today(
    kind: str,
    *,
    root: Path = Path("screenshots/raw"),
    capture_date: str | None = None,
    serial: str | None = None,
    client: ScreenshotClient | None = None,
) -> CaptureResult:
    validate_kind(kind)
    date_value = capture_date or today_europe_paris()
    day_dir = root / date_value
    output_path = next_capture_path(day_dir, kind)
    screenshot_client = client or AdbClient(serial=serial)
    screenshot_client.screenshot(output_path)
    return CaptureResult(
        path=output_path,
        kind=kind,
        capture_date=date_value,
        index=_capture_index(output_path),
    )


def next_capture_path(day_dir: Path, kind: str) -> Path:
    validate_kind(kind)
    next_index = next_capture_index(day_dir, kind)
    subdir, prefix = _CAPTURE_LAYOUT[kind]
    return day_dir / subdir / f"{prefix}-{next_index:03d}.png"


def next_capture_index(day_dir: Path, kind: str) -> int:
    validate_kind(kind)
    if not day_dir.exists():
        return 1

    indexes = [_capture_index(path) for path in capture_paths(day_dir, kind)]
    return max(indexes, default=0) + 1


def capture_paths(day_dir: Path, kind: str) -> list[Path]:
    validate_kind(kind)
    if not day_dir.exists():
        return []

    subdir, prefix = _CAPTURE_LAYOUT[kind]
    legacy_paths = [
        path
        for path in day_dir.glob(f"{kind}-*.png")
        if path.is_file() and _CAPTURE_NAME_PATTERN.fullmatch(path.name)
    ]
    nested_paths = [
        path
        for path in (day_dir / subdir).glob(f"{prefix}-*.png")
        if path.is_file() and _NESTED_CAPTURE_NAME_PATTERN.fullmatch(path.name)
    ]
    return sorted([*legacy_paths, *nested_paths], key=_capture_sort_key)


def validate_kind(kind: str) -> None:
    if kind not in CAPTURE_KINDS:
        valid = ", ".join(CAPTURE_KINDS)
        raise ValueError(f"unknown capture kind {kind!r}; expected one of: {valid}")


def today_europe_paris() -> str:
    return datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")


def _capture_index(path: Path) -> int:
    match = _CAPTURE_NAME_PATTERN.fullmatch(path.name) or _NESTED_CAPTURE_NAME_PATTERN.fullmatch(path.name)
    if match is None:
        raise ValueError(f"invalid capture file name: {path.name}")
    return int(match.group("index"))


def _capture_sort_key(path: Path) -> tuple[int, str]:
    return (_capture_index(path), str(path))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Capture a raw Archero screenshot into the dated screenshots directory.")
    parser.add_argument("kind", choices=CAPTURE_KINDS, help="Capture category used in the output filename.")
    parser.add_argument("--root", type=Path, default=Path("screenshots/raw"), help="Root raw screenshot directory.")
    parser.add_argument("--date", dest="capture_date", help="Capture date as YYYY-MM-DD. Defaults to today in Europe/Paris.")
    parser.add_argument("--serial", help="ADB device serial, useful when several devices are connected.")
    parser.add_argument("--dry-run", action="store_true", help="Print the path that would be used without calling ADB.")
    args = parser.parse_args(argv)

    try:
        if args.capture_date is not None:
            _validate_capture_date(args.capture_date)
        if args.dry_run:
            date_value = args.capture_date or today_europe_paris()
            output_path = next_capture_path(args.root / date_value, args.kind)
            result = CaptureResult(path=output_path, kind=args.kind, capture_date=date_value, index=_capture_index(output_path))
        else:
            result = capture_today(
                args.kind,
                root=args.root,
                capture_date=args.capture_date,
                serial=args.serial,
            )
    except ValueError as exc:
        parser.exit(1, f"error: {exc}\n")

    print(
        json.dumps(
            {
                "path": str(result.path),
                "kind": result.kind,
                "date": result.capture_date,
                "index": result.index,
                "dry_run": args.dry_run,
            },
            indent=2,
        )
    )
    return 0


def _validate_capture_date(value: str) -> None:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("date must use YYYY-MM-DD format") from exc


if __name__ == "__main__":
    raise SystemExit(main())
