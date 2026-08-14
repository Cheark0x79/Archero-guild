#!/usr/bin/env python3
"""Fail fast when tracked files violate the public-repository data boundary."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PATHS = {
    "web/.env.prod",
    "ocr/.env",
    "ocr/targets.json",
    "web/.env.development.local",
}
SECRET_PATTERNS = (
    re.compile(rb"gh[pousr]_[A-Za-z0-9_]{20,}"),
    re.compile(rb"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(rb"AKIA[0-9A-Z]{16}"),
    re.compile(rb"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----"),
    re.compile(rb"xox[baprs]-[A-Za-z0-9-]{20,}"),
)


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [item.decode() for item in result.stdout.split(b"\0") if item]


def main() -> int:
    failures: list[str] = []
    for relative in tracked_files():
        candidate = ROOT / relative
        if not candidate.is_file():
            continue
        if relative in FORBIDDEN_PATHS or relative.startswith(("backups/", "screenshots/", "data/")):
            failures.append(f"private operational path is tracked: {relative}")
            continue
        content = candidate.read_bytes()
        if any(pattern.search(content) for pattern in SECRET_PATTERNS):
            failures.append(f"possible credential material is tracked: {relative}")

    if failures:
        print("Repository hygiene failures:", *[f"- {item}" for item in failures], sep="\n", file=sys.stderr)
        return 1
    print("Repository hygiene check passed: no prohibited operational files or credential signatures are tracked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
