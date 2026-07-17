from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Region:
    x: int
    y: int
    width: int
    height: int

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "Region":
        return cls(
            x=_positive_int(value, "x", allow_zero=True),
            y=_positive_int(value, "y", allow_zero=True),
            width=_positive_int(value, "width"),
            height=_positive_int(value, "height"),
        )


@dataclass(frozen=True)
class ScreenTemplate:
    template: str
    threshold: float

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "ScreenTemplate":
        template = value.get("template")
        if not isinstance(template, str) or not template:
            raise ValueError("screen template must be a non-empty string")

        threshold = value.get("threshold", 0.85)
        if isinstance(threshold, bool) or not isinstance(threshold, int | float) or not 0 < float(threshold) <= 1:
            raise ValueError("screen threshold must be between 0 and 1")

        return cls(template=template, threshold=float(threshold))


@dataclass(frozen=True)
class AdbConfig:
    serial: str | None
    screenshot_dir: Path
    normalized_screenshot_dir: Path
    tap_timeout_seconds: int

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "AdbConfig":
        serial = value.get("serial")
        if serial is not None and not isinstance(serial, str):
            raise ValueError("adb.serial must be null or a string")

        screenshot_dir = value.get("screenshot_dir", "screenshots/raw")
        if not isinstance(screenshot_dir, str) or not screenshot_dir:
            raise ValueError("adb.screenshot_dir must be a non-empty string")

        normalized_screenshot_dir = value.get("normalized_screenshot_dir", "screenshots/normalized")
        if not isinstance(normalized_screenshot_dir, str) or not normalized_screenshot_dir:
            raise ValueError("adb.normalized_screenshot_dir must be a non-empty string")

        return cls(
            serial=serial,
            screenshot_dir=Path(screenshot_dir),
            normalized_screenshot_dir=Path(normalized_screenshot_dir),
            tap_timeout_seconds=_positive_int(value, "tap_timeout_seconds"),
        )


@dataclass(frozen=True)
class OcrConfig:
    min_auto_confidence: int
    min_history_confidence: int

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "OcrConfig":
        auto = _positive_int(value, "min_auto_confidence")
        history = _positive_int(value, "min_history_confidence")
        if auto > 100 or history > 100:
            raise ValueError("OCR confidence thresholds must be <= 100")
        if history > auto:
            raise ValueError("history confidence threshold cannot exceed auto threshold")
        return cls(min_auto_confidence=auto, min_history_confidence=history)


@dataclass(frozen=True)
class ObserverConfig:
    run_id_prefix: str
    dry_run: bool
    adb: AdbConfig
    screens: dict[str, ScreenTemplate]
    regions: dict[str, Region]
    ocr: OcrConfig

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "ObserverConfig":
        prefix = value.get("run_id_prefix", "archero")
        if not isinstance(prefix, str) or not prefix:
            raise ValueError("run_id_prefix must be a non-empty string")

        dry_run = value.get("dry_run", True)
        if not isinstance(dry_run, bool):
            raise ValueError("dry_run must be a boolean")

        screens = value.get("screens", {})
        if not isinstance(screens, dict):
            raise ValueError("screens must be an object")

        regions = value.get("regions", {})
        if not isinstance(regions, dict):
            raise ValueError("regions must be an object")

        return cls(
            run_id_prefix=prefix,
            dry_run=dry_run,
            adb=AdbConfig.from_mapping(_object(value, "adb")),
            screens={key: ScreenTemplate.from_mapping(_object(screens, key)) for key in screens},
            regions={key: Region.from_mapping(_object(regions, key)) for key in regions},
            ocr=OcrConfig.from_mapping(_object(value, "ocr")),
        )


def load_config(path: Path) -> ObserverConfig:
    with path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise ValueError("configuration root must be an object")
    return ObserverConfig.from_mapping(raw)


def _object(value: dict[str, Any], key: str) -> dict[str, Any]:
    item = value.get(key)
    if not isinstance(item, dict):
        raise ValueError(f"{key} must be an object")
    return item


def _positive_int(value: dict[str, Any], key: str, *, allow_zero: bool = False) -> int:
    item = value.get(key)
    if isinstance(item, bool) or not isinstance(item, int):
        raise ValueError(f"{key} must be an integer")
    if allow_zero:
        if item < 0:
            raise ValueError(f"{key} must be >= 0")
    elif item <= 0:
        raise ValueError(f"{key} must be > 0")
    return item
