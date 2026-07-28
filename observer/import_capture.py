from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime
from pathlib import Path
from typing import Sequence
from zoneinfo import ZoneInfo

from observer.capture import capture_paths
from observer.pipeline.guild_boss import (
    ExtractedBossRanking,
    GuildBossDetectionError,
    detect_boss_ranking_rows,
    extract_boss_rankings_from_screenshots,
    repair_boss_ranking_order,
)
from observer.pipeline.guild_member_ocr import ExtractedMemberMetrics, RosterEntry, extract_member_metrics_from_screenshots
from observer.pipeline.guild_members import detect_member_rows
from observer.pipeline.image_geometry import ImageGeometry, image_geometry_for_path


_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LAST_IMPORT_PATTERN = re.compile(r'lastImportedAt: "[^"]+"')
_LAST_CAPTURE_LINE_PATTERN = re.compile(r'(lastCapturedAt: "[^"]+",\n)')
_CHANGE_CAPTURE_PATTERN = re.compile(
    r'\{\n'
    r'    type: "capture",\n'
    r'    title: "[^"]+",\n'
    r'    detail: "[^"]+",\n'
    r'    at: "[^"]+",\n'
    r'  \}',
    re.MULTILINE,
)
_ROSTER_ENTRY_PATTERN = re.compile(
    r'\{ playerId: "([^"]+)", name: "([^"]+)"(?P<metadata>[^}]*)\}'
)
_SNAPSHOT_PATTERN = re.compile(
    r'screenshotMember\("(?P<player_id>[^"]+)", "(?P<role>[^"]+)", (?P<power>\d+), '
    r'(?P<donation>\d+), (?P<boss>\d+), (?P<activity>\d+), "(?P<source>[^"]+)"'
    r'(?:, (?P<seen_at>null|"[^"]+"))?\)'
)
_DAILY_BLOCK_PATTERN = re.compile(
    r'(?P<block>  \{\n'
    r'    date: "(?P<date>\d{4}-\d{2}-\d{2})",\n'
    r'    rows: \[\n'
    r'.*?\n'
    r'    \],\n'
    r'  \},)',
    re.DOTALL,
)


@dataclass(frozen=True)
class ImportedScreenshot:
    path: str
    kind: str
    row_count: int | None = None
    sha256: str | None = None
    source_width: int | None = None
    source_height: int | None = None
    analysis_width: int | None = None
    analysis_height: int | None = None


@dataclass(frozen=True)
class ImportReport:
    date: str
    captured_at: str
    raw_dir: str
    member_screenshots: list[ImportedScreenshot]
    boss_screenshots: list[ImportedScreenshot]
    detected_member_rows: int
    detected_boss_rows: int
    extracted_member_metrics: int
    report_path: str
    front_updated: bool
    quality: dict[str, object] = field(default_factory=dict)
    backup_path: str | None = None
    database_persisted: bool = False


class ImportValidationError(RuntimeError):
    pass


def validate_detected_layouts(
    *,
    member_screenshots: Sequence[ImportedScreenshot],
    boss_screenshots: Sequence[ImportedScreenshot],
) -> None:
    errors: list[str] = []
    for label, screenshots in (
        ("guild", member_screenshots),
        ("boss", boss_screenshots),
    ):
        if len(screenshots) < 2:
            continue
        empty = [Path(item.path).name for item in screenshots if not item.row_count]
        if len(empty) / len(screenshots) > 0.25:
            errors.append(
                f"{label} layout detection failed on {len(empty)}/{len(screenshots)} screenshots "
                f"({', '.join(empty)}); check emulator resolution, orientation, and captured screen"
            )
    if errors:
        raise ImportValidationError("Capture preflight failed: " + "; ".join(errors))


def validate_extracted_import(
    *,
    member_screenshots: Sequence[ImportedScreenshot],
    boss_screenshots: Sequence[ImportedScreenshot],
    extracted_metrics: Sequence[ExtractedMemberMetrics],
    boss_rankings: Sequence[ExtractedBossRanking],
    expected_member_count: int | None = None,
) -> dict[str, object]:
    errors: list[str] = []
    detected_member_rows = sum(item.row_count or 0 for item in member_screenshots)
    detected_boss_rows = sum(item.row_count or 0 for item in boss_screenshots)
    unique_boss_rankings = _unique_boss_rankings(list(boss_rankings))
    member_coverage = len(extracted_metrics) / detected_member_rows if detected_member_rows else 1.0
    detected_roster_coverage = (
        min(detected_member_rows / expected_member_count, 1.0)
        if expected_member_count
        else None
    )
    roster_coverage = (
        min(len(extracted_metrics) / expected_member_count, 1.0)
        if expected_member_count
        else None
    )
    boss_coverage = len([row for row in unique_boss_rankings if row.boss_rank is not None]) / detected_boss_rows if detected_boss_rows else 1.0
    warnings: list[str] = []

    if expected_member_count and detected_member_rows < math.ceil(expected_member_count * 0.90):
        errors.append(
            f"incomplete guild capture: detected {detected_member_rows} rows for "
            f"{expected_member_count} roster members; upload the remaining guild screenshots"
        )
    elif expected_member_count and len(extracted_metrics) < math.ceil(expected_member_count * 0.85):
        errors.append(
            f"guild OCR matched only {len(extracted_metrics)} of {expected_member_count} roster members"
        )
    elif detected_member_rows and not extracted_metrics:
        errors.append(f"member OCR extracted 0 of {detected_member_rows} detected rows")
    elif detected_member_rows >= 5 and member_coverage < 0.65:
        errors.append(f"member OCR coverage is only {member_coverage:.0%}")
    elif detected_member_rows >= 5 and member_coverage < 0.85:
        warnings.append(f"member OCR coverage is {member_coverage:.0%}; human review recommended")
    member_ids = [metric.player_id for metric in extracted_metrics if metric.player_id]
    duplicate_member_ids = sorted({player_id for player_id in member_ids if member_ids.count(player_id) > 1})
    if duplicate_member_ids:
        errors.append(f"duplicate member IDs: {', '.join(duplicate_member_ids)}")

    if detected_boss_rows and not boss_rankings:
        errors.append(f"boss OCR extracted 0 of {detected_boss_rows} detected rows")
    elif detected_boss_rows >= 5 and boss_coverage < 0.65:
        errors.append(f"boss OCR coverage is only {boss_coverage:.0%}")
    elif detected_boss_rows >= 5 and boss_coverage < 0.85:
        warnings.append(f"boss OCR coverage is {boss_coverage:.0%}; human review recommended")
    # The game repeats the current player's sticky row while scrolling. Keep the
    # best OCR result for each rank before checking the ranking order.
    ranked = sorted(
        (
            ranking
            for ranking in unique_boss_rankings
            if ranking.boss_rank is not None and ranking.boss_damage_today is not None
        ),
        key=lambda ranking: ranking.boss_rank or 0,
    )
    rank_numbers = sorted({ranking.boss_rank for ranking in unique_boss_rankings if ranking.boss_rank is not None})
    if len(rank_numbers) >= 2:
        missing_ranks = sorted(set(range(rank_numbers[0], rank_numbers[-1] + 1)) - set(rank_numbers))
        if missing_ranks:
            warnings.append(
                "boss ranking is missing rank(s) "
                f"{', '.join(str(rank) for rank in missing_ranks)}; capture overlapping scroll positions"
            )
    for previous, current in zip(ranked, ranked[1:]):
        if current.boss_damage_today > previous.boss_damage_today:
            errors.append(
                f"boss rank {current.boss_rank} damage {current.damage_text} exceeds "
                f"rank {previous.boss_rank} damage {previous.damage_text}"
            )
            break

    if errors:
        raise ImportValidationError("Import validation failed: " + "; ".join(errors))
    return {
        "status": "accepted_with_warnings" if warnings else "accepted",
        "member_coverage": round(member_coverage, 4),
        "detected_roster_coverage": round(detected_roster_coverage, 4) if detected_roster_coverage is not None else None,
        "roster_coverage": round(roster_coverage, 4) if roster_coverage is not None else None,
        "boss_coverage": round(boss_coverage, 4),
        "warnings": warnings,
        "errors": [],
    }


def import_capture_day(
    capture_date: str | None = None,
    *,
    raw_root: Path = Path("screenshots/raw"),
    imports_root: Path = Path("data/imports"),
    sample_data_path: Path = Path("web/sample-data.js"),
    captured_at: str | None = None,
    update_front: bool = True,
) -> ImportReport:
    selected_date = capture_date or latest_capture_date(raw_root)
    validate_capture_date(selected_date)
    with import_lock(imports_root, selected_date):
        return _import_capture_day_unlocked(
            selected_date,
            raw_root=raw_root,
            imports_root=imports_root,
            sample_data_path=sample_data_path,
            captured_at=captured_at,
            update_front=update_front,
        )


def _import_capture_day_unlocked(
    capture_date: str,
    *,
    raw_root: Path,
    imports_root: Path,
    sample_data_path: Path,
    captured_at: str | None,
    update_front: bool,
) -> ImportReport:
    validate_capture_date(capture_date)
    raw_dir = raw_root / capture_date
    if not raw_dir.exists():
        raise FileNotFoundError(raw_dir)

    progress("find_raw", f"Reading raw screenshots for {capture_date}.", 4)
    member_paths = capture_paths(raw_dir, "guild-members")
    boss_paths = capture_paths(raw_dir, "guild-boss")
    if not member_paths and not boss_paths:
        raise ValueError(f"no guild capture screenshots found in {raw_dir}")

    member_screenshots = []
    for index, path in enumerate(member_paths, start=1):
        progress("detect_members", f"Detecting guild rows in {path.name} ({index}/{len(member_paths)}).", 8 + _portion(index, len(member_paths), 18))
        rows = detect_member_rows(path)
        geometry = _optional_image_geometry(path)
        member_screenshots.append(
            ImportedScreenshot(
                path=path.as_posix(),
                kind="guild-members",
                row_count=len(rows),
                sha256=file_sha256(path),
                **_geometry_fields(geometry),
            )
        )
    boss_screenshots = []
    for index, path in enumerate(boss_paths, start=1):
        progress("detect_boss", f"Detecting boss rows in {path.name} ({index}/{len(boss_paths)}).", 26 + _portion(index, len(boss_paths), 12))
        rows = detect_boss_ranking_rows(path)
        geometry = _optional_image_geometry(path)
        boss_screenshots.append(
            ImportedScreenshot(
                path=path.as_posix(),
                kind="guild-boss",
                row_count=len(rows),
                sha256=file_sha256(path),
                **_geometry_fields(geometry),
            )
        )
    detected_member_rows = sum(item.row_count or 0 for item in member_screenshots)
    detected_boss_rows = sum(item.row_count or 0 for item in boss_screenshots)
    captured_at_value = captured_at or default_captured_at(capture_date)

    report_path = imports_root / f"{capture_date}.json"
    extracted_metrics: list[ExtractedMemberMetrics] = []
    previous_metrics: list[ExtractedMemberMetrics] = []
    daily_metrics: dict[str, list[ExtractedMemberMetrics]] = {}
    daily_boss_rankings: dict[str, list[ExtractedBossRanking]] = {}
    previous_date: str | None = None
    if sample_data_path.exists():
        roster = read_roster_entries(sample_data_path)
    else:
        roster = []
    if member_screenshots and boss_screenshots:
        progress("preflight", "Checking screenshot layouts before OCR.", 39)
        validate_detected_layouts(
            member_screenshots=member_screenshots,
            boss_screenshots=boss_screenshots,
        )
    if member_paths and sample_data_path.exists():
        progress("extract_current_members", f"Extracting current guild metrics from {len(member_paths)} screenshot(s).", 40)
        extracted_metrics = extract_member_metrics_from_screenshots(member_paths, roster)
        previous_date = previous_capture_date(raw_root, capture_date)
        if previous_date is not None:
            previous_member_paths = capture_paths(raw_root / previous_date, "guild-members")
            if previous_member_paths:
                progress("extract_daily_members", f"Extracting previous guild metrics for {previous_date}.", 48)
                previous_metrics = extract_member_metrics_from_screenshots(previous_member_paths, roster)
        daily_metrics[capture_date] = extracted_metrics
    if boss_paths and detected_boss_rows and sample_data_path.exists():
        progress("extract_boss", f"Extracting boss rankings for {capture_date}.", 76)
        daily_boss_rankings[capture_date] = extract_boss_rankings_from_screenshots(boss_paths, roster)

    progress("validate_import", "Validating extracted guild and boss data.", 82)
    quality = validate_extracted_import(
        member_screenshots=member_screenshots,
        boss_screenshots=boss_screenshots,
        extracted_metrics=extracted_metrics,
        boss_rankings=daily_boss_rankings.get(capture_date, []),
        expected_member_count=len(roster),
    )

    backup_path = backup_before_publish(sample_data_path, imports_root, capture_date) if update_front else None
    report = ImportReport(
        date=capture_date,
        captured_at=captured_at_value,
        raw_dir=raw_dir.as_posix(),
        member_screenshots=member_screenshots,
        boss_screenshots=boss_screenshots,
        detected_member_rows=detected_member_rows,
        detected_boss_rows=detected_boss_rows,
        extracted_member_metrics=len(extracted_metrics),
        report_path=report_path.as_posix(),
        front_updated=update_front,
        quality=quality,
        backup_path=backup_path.as_posix() if backup_path else None,
    )

    from observer.storage.persistence import persist_import_if_configured

    try:
        if update_front:
            progress("update_front", "Updating dashboard sample data file.", 88)
            update_sample_data(sample_data_path, report, extracted_metrics, previous_metrics, previous_date, daily_metrics, daily_boss_rankings)
        progress("persist_database", "Persisting import into PostgreSQL when configured.", 94)
        database_persisted = persist_import_if_configured(
            report,
            roster=roster,
            extracted_metrics=extracted_metrics,
            daily_boss_rankings=daily_boss_rankings,
        )
    except Exception:
        if backup_path and backup_path.exists():
            shutil.copy2(backup_path, sample_data_path)
        raise

    report = replace(report, database_persisted=database_persisted)
    progress("write_report", f"Writing completed import report {report_path}.", 98)
    write_report(report, report_path)

    progress("done", "Import finished.", 100)
    return report


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _optional_image_geometry(path: Path) -> ImageGeometry | None:
    try:
        return image_geometry_for_path(path)
    except OSError:
        return None


def _geometry_fields(geometry: ImageGeometry | None) -> dict[str, int | None]:
    if geometry is None:
        return {
            "source_width": None,
            "source_height": None,
            "analysis_width": None,
            "analysis_height": None,
        }
    return {
        "source_width": geometry.source_width,
        "source_height": geometry.source_height,
        "analysis_width": geometry.analysis_width,
        "analysis_height": geometry.analysis_height,
    }


def backup_before_publish(sample_data_path: Path, imports_root: Path, capture_date: str) -> Path:
    backup_dir = imports_root.parent / "backups" / "imports" / capture_date
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"sample-data-{time.time_ns()}.js"
    shutil.copy2(sample_data_path, backup_path)
    return backup_path


@contextmanager
def import_lock(imports_root: Path, capture_date: str):
    lock_dir = imports_root / ".locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / f"{capture_date}.lock"
    descriptor = _create_import_lock(lock_path, capture_date)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump({"pid": os.getpid(), "started_at": datetime.now().isoformat()}, handle)
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def _create_import_lock(lock_path: Path, capture_date: str) -> int:
    try:
        return os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        try:
            stale = time.time() - lock_path.stat().st_mtime > 2 * 60 * 60
        except FileNotFoundError:
            stale = True
        if stale:
            lock_path.unlink(missing_ok=True)
            try:
                return os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                pass
        raise RuntimeError(f"an import for {capture_date} is already running") from exc


def write_report(report: ImportReport, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    _write_text_atomic(output_path, json.dumps(asdict(report), indent=2) + "\n")


def progress(phase: str, message: str, progress_value: int) -> None:
    if os.environ.get("ARCHERO_PROGRESS") != "1":
        return
    payload = {"phase": phase, "message": message, "progress": progress_value}
    print(f"__ARCHERO_PROGRESS__{json.dumps(payload, ensure_ascii=False)}", file=sys.stderr, flush=True)


def _portion(index: int, total: int, size: int) -> int:
    if total <= 0:
        return 0
    return round((index / total) * size)


def update_sample_data(
    path: Path,
    report: ImportReport,
    extracted_metrics: list[ExtractedMemberMetrics] | None = None,
    previous_metrics: list[ExtractedMemberMetrics] | None = None,
    previous_date: str | None = None,
    daily_metrics: dict[str, list[ExtractedMemberMetrics]] | None = None,
    daily_boss_rankings: dict[str, list[ExtractedBossRanking]] | None = None,
) -> None:
    if not path.exists():
        raise FileNotFoundError(path)

    content = path.read_text(encoding="utf-8")
    content = _upsert_last_imported_at(content, report.captured_at, path)
    if previous_metrics:
        content = _upsert_previous_member_snapshots(content, previous_metrics, previous_date)
    if extracted_metrics:
        content = _update_member_snapshots(content, extracted_metrics, path, report.date)
    if daily_metrics:
        content = _upsert_daily_raw_snapshots(content, daily_metrics)
    if daily_boss_rankings:
        content = _upsert_daily_boss_raw_snapshots(content, report, daily_boss_rankings)
    elif report.boss_screenshots:
        content = _upsert_daily_boss_raw_snapshots(content, report, None)

    title = f"{len(report.member_screenshots)} guild screenshots imported"
    detail = (
        f"Detected {report.detected_member_rows} visible guild rows from "
        f"{_range_label(report.member_screenshots, 'guild-members')} and "
        f"{report.detected_boss_rows} visible MI ranking rows from "
        f"{_range_label(report.boss_screenshots, 'guild-boss')}."
    )
    replacement = (
        "{\n"
        '    type: "capture",\n'
        f'    title: "{title}",\n'
        f'    detail: "{detail}",\n'
        f'    at: "{report.date}",\n'
        "  }"
    )
    content, change_count = _CHANGE_CAPTURE_PATTERN.subn(replacement, content, count=1)
    if change_count != 1:
        raise ValueError(f"could not update capture change entry in {path}")

    _write_text_atomic(path, content)


def _write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def latest_capture_date(raw_root: Path) -> str:
    if not raw_root.exists():
        raise FileNotFoundError(raw_root)
    dates = sorted(path.name for path in raw_root.iterdir() if path.is_dir() and _DATE_PATTERN.fullmatch(path.name))
    if not dates:
        raise FileNotFoundError(f"no dated capture folders found in {raw_root}")
    return dates[-1]


def previous_capture_date(raw_root: Path, capture_date: str) -> str | None:
    if not raw_root.exists():
        raise FileNotFoundError(raw_root)
    dates = sorted(path.name for path in raw_root.iterdir() if path.is_dir() and _DATE_PATTERN.fullmatch(path.name))
    previous_dates = [date for date in dates if date < capture_date]
    return previous_dates[-1] if previous_dates else None


def capture_dates(raw_root: Path, *, until: str | None = None) -> list[str]:
    if not raw_root.exists():
        raise FileNotFoundError(raw_root)
    dates = sorted(path.name for path in raw_root.iterdir() if path.is_dir() and _DATE_PATTERN.fullmatch(path.name))
    if until is None:
        return dates
    return [date for date in dates if date <= until]


def read_roster_entries(path: Path) -> list[RosterEntry]:
    content = path.read_text(encoding="utf-8")
    snapshots = _parse_existing_snapshots(_find_exported_array(content, "memberSnapshots")[2]) if _find_exported_array(content, "memberSnapshots") else {}
    roster_block = _find_exported_array(content, "guildRoster")
    if roster_block is None:
        return []
    entries: list[RosterEntry] = []
    for match in _ROSTER_ENTRY_PATTERN.finditer(roster_block[2]):
        player_id = match.group(1)
        metadata = match.group("metadata")
        if player_id == "null" or re.search(r'status:\s*"(?:left|kicked)"', metadata):
            continue
        snapshot = snapshots.get(player_id)
        entries.append(RosterEntry(player_id=player_id, name=match.group(2), power_hint=snapshot["power"] if snapshot else None))
    return entries


def _update_member_snapshots(content: str, extracted_metrics: list[ExtractedMemberMetrics], path: Path, current_date: str) -> str:
    block = _find_exported_array(content, "memberSnapshots")
    if block is None:
        raise ValueError(f"could not find memberSnapshots block in {path}")

    start, end, body = block
    existing = _parse_existing_snapshots(body)
    extracted_by_player = {metric.player_id: metric for metric in extracted_metrics}
    lines: list[str] = []
    for player_id, snapshot in existing.items():
        metric = extracted_by_player.get(player_id)
        if metric is None:
            role = snapshot["role"]
            power = snapshot["power"]
            donation = snapshot["donation"]
            boss = snapshot["boss"]
            activity = snapshot["activity"]
            source = snapshot["source"]
            seen_at = snapshot["seen_at"]
        else:
            role = metric.role or snapshot["role"]
            power = _validated_power(metric.power, snapshot["power"])
            donation = metric.donation if metric.donation is not None and 0 <= metric.donation <= 20_000 else snapshot["donation"]
            boss = metric.boss_tries if metric.boss_tries is not None and 0 <= metric.boss_tries <= 10 else snapshot["boss"]
            activity = metric.last_activity_days if metric.last_activity_days is not None and 0 <= metric.last_activity_days <= 30 else snapshot["activity"]
            source = metric.source
            seen_at = current_date
        lines.append(
            f'  screenshotMember("{player_id}", "{role}", {power}, {donation}, {boss}, {activity}, '
            f'"{source}", {_js_nullable_string(seen_at)}),'
        )

    replacement = "export const memberSnapshots = [\n" + "\n".join(lines) + "\n];"
    return content[:start] + replacement + content[end:]


def _find_exported_array(content: str, name: str) -> tuple[int, int, str] | None:
    marker = f"export const {name} = ["
    start = content.find(marker)
    if start == -1:
        return None
    body_start = content.find("\n", start)
    if body_start == -1:
        return None
    end_marker = "\n];"
    end = content.find(end_marker, body_start)
    if end == -1:
        return None
    body = content[body_start + 1 : end]
    return start, end + len(end_marker), body


def _upsert_previous_member_snapshots(content: str, previous_metrics: list[ExtractedMemberMetrics], previous_date: str | None) -> str:
    lines = [
        (
            f'  previousSnapshotMember("{metric.player_id}", "{metric.role or "member"}", '
            f'{_nullable_valid_power(metric.power)}, '
            f'{metric.donation if metric.donation is not None else "null"}, '
            f'{metric.boss_tries if metric.boss_tries is not None else "null"}, '
            f'{metric.last_activity_days if metric.last_activity_days is not None else "null"}, '
            f'"{metric.source}", {_js_nullable_string(previous_date)}),'
        )
        for metric in previous_metrics
    ]
    block = "export const previousMemberSnapshots = [\n" + "\n".join(lines) + "\n];\n\n"
    existing = _find_exported_array(content, "previousMemberSnapshots")
    if existing is not None:
        start, end, _body = existing
        suffix_end = end
        if content[suffix_end : suffix_end + 2] == "\n\n":
            suffix_end += 2
        elif content[suffix_end : suffix_end + 1] == "\n":
            suffix_end += 1
        return content[:start] + block + "\n\n" + content[suffix_end:]
    return content.replace("export const memberSnapshots = [", block + "export const memberSnapshots = [", 1)


def _upsert_daily_raw_snapshots(content: str, daily_metrics: dict[str, list[ExtractedMemberMetrics]]) -> str:
    content = _ensure_raw_snapshot_member_helper(content)
    day_blocks: dict[str, str] = {}
    for day, metrics in sorted(daily_metrics.items()):
        lines = [
            (
                f'    rawSnapshotMember("{metric.player_id}", "{metric.role or "member"}", '
                f'{_nullable_valid_power(metric.power)}, '
                f'{metric.donation if metric.donation is not None else "null"}, '
                f'{metric.boss_tries if metric.boss_tries is not None else "null"}, '
                f'{metric.last_activity_days if metric.last_activity_days is not None else "null"}, '
                f'"{metric.source}", "{day}"),'
            )
            for metric in metrics
        ]
        rows = "\n".join(lines)
        day_blocks[day] = f'  {{\n    date: "{day}",\n    rows: [\n{rows}\n    ],\n  }},'

    block = _merged_daily_array_block(content, "dailyRawSnapshots", day_blocks)
    existing = _find_exported_array(content, "dailyRawSnapshots")
    if existing is not None:
        start, end, _body = existing
        suffix_end = end
        if content[suffix_end : suffix_end + 2] == "\n\n":
            suffix_end += 2
        elif content[suffix_end : suffix_end + 1] == "\n":
            suffix_end += 1
        return content[:start] + block + "\n\n" + content[suffix_end:]

    return content.replace("export const changes = [", block + "\n\nexport const changes = [", 1)


def _ensure_raw_snapshot_member_helper(content: str) -> str:
    if "function rawSnapshotMember(" in content:
        return content

    helper = """function rawSnapshotMember(playerId, role, power, donation, bossAttacks, lastActivityDays, source, seenAt = null) {
  return {
    playerId,
    role,
    power,
    contribution7d: donation,
    bossAttacks,
    bossDamageToday: null,
    lastActivityDays,
    lastSeenAt: seenAt,
    verificationNote: `Screenshot check: ${source}.`,
  };
}

"""
    marker = "export const memberSnapshots = ["
    if marker in content:
        return content.replace(marker, helper + marker, 1)
    return helper + content


def _upsert_daily_boss_raw_snapshots(
    content: str,
    report: ImportReport,
    daily_boss_rankings: dict[str, list[ExtractedBossRanking]] | None,
) -> str:
    content = _ensure_raw_boss_snapshot_helper(content)
    day_blocks: dict[str, str] = {}
    if daily_boss_rankings:
        for day, rankings in sorted(daily_boss_rankings.items()):
            rankings = _unique_boss_rankings(rankings)
            lines = [
                (
                    f'      rawBossSnapshotRow({_js_string(ranking.source)}, {ranking.row_index}, "{day}", '
                    f'{{ area: "{ranking.area}", '
                    f'bossRank: {ranking.boss_rank if ranking.boss_rank is not None else "null"}, '
                    f'playerId: {_js_nullable_string(ranking.player_id)}, '
                    f'name: {_js_nullable_string(ranking.name)}, '
                    f'rawName: {_js_nullable_string(ranking.raw_name)}, '
                    f'damageText: {_js_nullable_string(ranking.damage_text)}, '
                    f'bossDamageToday: {ranking.boss_damage_today if ranking.boss_damage_today is not None else "null"} }}),'
                )
                for ranking in rankings
            ]
            rows = "\n".join(lines)
            day_blocks[day] = f'  {{\n    date: "{day}",\n    rows: [\n{rows}\n    ],\n  }},'
    else:
        lines: list[str] = []
        for screenshot_index, screenshot in enumerate(report.boss_screenshots):
            filename = _source_label(Path(screenshot.path), report.date)
            if screenshot_index == 0:
                for rank in range(1, 4):
                    lines.append(
                        f'      rawBossSnapshotRow("{filename} podium {rank}", {rank - 1}, "{report.date}", '
                        f'{{ area: "podium", bossRank: {rank} }}),'
                    )
            for row_index in range(screenshot.row_count or 0):
                lines.append(f'      rawBossSnapshotRow("{filename} row {row_index}", {row_index}, "{report.date}", {{ area: "list" }}),')
        rows = "\n".join(lines)
        day_blocks[report.date] = f'  {{\n    date: "{report.date}",\n    rows: [\n{rows}\n    ],\n  }},'

    block = _merged_daily_array_block(content, "dailyBossRawSnapshots", day_blocks)
    existing = _find_exported_array(content, "dailyBossRawSnapshots")
    if existing is not None:
        start, end, _body = existing
        suffix_end = end
        if content[suffix_end : suffix_end + 2] == "\n\n":
            suffix_end += 2
        elif content[suffix_end : suffix_end + 1] == "\n":
            suffix_end += 1
        return content[:start] + block + "\n\n" + content[suffix_end:]

    return content.replace("export const changes = [", block + "\n\nexport const changes = [", 1)


def _unique_boss_rankings(rankings: list[ExtractedBossRanking]) -> list[ExtractedBossRanking]:
    by_rank: dict[int, ExtractedBossRanking] = {}
    unranked: list[ExtractedBossRanking] = []
    for ranking in rankings:
        if ranking.boss_rank is None:
            unranked.append(ranking)
            continue
        current = by_rank.get(ranking.boss_rank)
        if current is None or _boss_ranking_quality(ranking) > _boss_ranking_quality(current):
            by_rank[ranking.boss_rank] = ranking
    ranked = sorted(by_rank.values(), key=lambda ranking: ranking.boss_rank or 0)
    return repair_boss_ranking_order(ranked) + unranked


def _boss_ranking_quality(ranking: ExtractedBossRanking) -> tuple[int, int, int]:
    useful_raw_name = bool(ranking.raw_name and len(re.sub(r"[^A-Za-z0-9]+", "", ranking.raw_name)) >= 3)
    return (
        1 if ranking.player_id else 0,
        1 if ranking.name or useful_raw_name else 0,
        1 if ranking.boss_damage_today is not None else 0,
    )


def _merged_daily_array_block(content: str, name: str, replacement_blocks: dict[str, str]) -> str:
    existing = _find_exported_array(content, name)
    blocks_by_date: dict[str, str] = {}
    if existing is not None:
        _start, _end, body = existing
        blocks_by_date.update(_parse_daily_blocks(body))
    blocks_by_date.update(replacement_blocks)
    day_blocks = [blocks_by_date[day] for day in sorted(blocks_by_date)]
    return f"export const {name} = [\n" + "\n".join(day_blocks) + "\n];"


def _parse_daily_blocks(body: str) -> dict[str, str]:
    return {match.group("date"): match.group("block") for match in _DAILY_BLOCK_PATTERN.finditer(body)}


def _source_label(path: Path, capture_date: str) -> str:
    parts = path.parts
    if len(parts) >= 3 and parts[-3] == capture_date:
        return (Path(parts[-2]) / parts[-1]).as_posix()
    return path.name


def _ensure_raw_boss_snapshot_helper(content: str) -> str:
    if "function rawBossSnapshotRow(" in content:
        return content

    helper = """function rawBossSnapshotRow(source, rowIndex, seenAt = null, data = {}) {
  return {
    source,
    rowIndex,
    area: data.area ?? "list",
    bossRank: data.bossRank ?? null,
    playerId: data.playerId ?? null,
    name: data.name ?? null,
    rawName: data.rawName ?? null,
    damageText: data.damageText ?? null,
    bossDamageToday: data.bossDamageToday ?? null,
    rowLabel: data.area === "podium" ? `Top ${data.bossRank ?? rowIndex + 1}` : `Boss row ${rowIndex + 1}`,
    lastSeenAt: seenAt,
  };
}

"""
    marker = "export const dailyRawSnapshots = ["
    if marker in content:
        return content.replace(marker, helper + marker, 1)
    return helper + content


def _parse_existing_snapshots(body: str) -> dict[str, dict[str, object]]:
    snapshots: dict[str, dict[str, object]] = {}
    for match in _SNAPSHOT_PATTERN.finditer(body):
        snapshots[match.group("player_id")] = {
            "role": match.group("role"),
            "power": int(match.group("power")),
            "donation": int(match.group("donation")),
            "boss": int(match.group("boss")),
            "activity": int(match.group("activity")),
            "source": match.group("source"),
            "seen_at": _parse_js_nullable_string(match.group("seen_at")),
        }
    return snapshots


def _parse_js_nullable_string(value: str | None) -> str | None:
    if value is None or value == "null":
        return None
    return value.strip('"')


def _js_nullable_string(value: object) -> str:
    if value is None:
        return "null"
    return _js_string(value)


def _js_string(value: object) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def _validated_power(candidate: int | None, previous: object) -> int:
    previous_value = int(previous)
    if candidate is None:
        return previous_value
    if candidate < 10_000 or candidate > 20_000_000:
        return previous_value
    if previous_value and not (previous_value * 0.75 <= candidate <= previous_value * 1.75):
        return previous_value
    return candidate


def _nullable_valid_power(candidate: int | None) -> int | str:
    if candidate is None or candidate < 10_000 or candidate > 20_000_000:
        return "null"
    return candidate


def _upsert_last_imported_at(content: str, captured_at: str, path: Path) -> str:
    content, import_count = _LAST_IMPORT_PATTERN.subn(f'lastImportedAt: "{captured_at}"', content, count=1)
    if import_count == 1:
        return content

    content, capture_count = _LAST_CAPTURE_LINE_PATTERN.subn(rf'\1  lastImportedAt: "{captured_at}",\n', content, count=1)
    if capture_count != 1:
        raise ValueError(f"could not update lastImportedAt in {path}")
    return content


def validate_capture_date(value: str) -> None:
    if _DATE_PATTERN.fullmatch(value) is None:
        raise ValueError("date must use YYYY-MM-DD format")
    datetime.strptime(value, "%Y-%m-%d")


def default_captured_at(capture_date: str) -> str:
    now = datetime.now(ZoneInfo("Europe/Paris"))
    if capture_date == now.strftime("%Y-%m-%d"):
        return now.isoformat(timespec="seconds")
    return f"{capture_date}T00:00:00+02:00"


def _range_label(items: list[ImportedScreenshot], prefix: str) -> str:
    if not items:
        return f"no {prefix} files"
    names = [Path(item.path).name for item in items]
    if len(names) == 1:
        return names[0]
    return f"{names[0]} to {names[-1]}"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import a dated Archero capture folder and update dashboard metadata.")
    parser.add_argument("date", nargs="?", help="Capture date to import, as YYYY-MM-DD. Defaults to the latest folder in screenshots/raw.")
    parser.add_argument("--raw-root", type=Path, default=Path("screenshots/raw"))
    parser.add_argument("--imports-root", type=Path, default=Path("data/imports"))
    parser.add_argument("--sample-data", type=Path, default=Path("web/sample-data.js"))
    parser.add_argument("--captured-at", help="Override imported timestamp, ISO-8601 string.")
    parser.add_argument("--no-front-update", action="store_true", help="Only write the JSON import report.")
    args = parser.parse_args(argv)

    try:
        report = import_capture_day(
            args.date,
            raw_root=args.raw_root,
            imports_root=args.imports_root,
            sample_data_path=args.sample_data,
            captured_at=args.captured_at,
            update_front=not args.no_front_update,
        )
    except (FileNotFoundError, ValueError, RuntimeError, GuildBossDetectionError, OSError) as exc:
        parser.exit(1, f"error: {exc}\n")

    print(json.dumps(asdict(report), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
