#!/usr/bin/env python3
"""Keep committed environment examples, Compose interpolation, and docs aligned."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VARIABLE = re.compile(r"\$\{([A-Z][A-Z0-9_]*)")
ENV_LINE = re.compile(r"^([A-Z][A-Z0-9_]*)=")


def env_keys(relative: str) -> set[str]:
    return {
        match.group(1)
        for line in (ROOT / relative).read_text().splitlines()
        if (match := ENV_LINE.match(line))
    }


def compose_keys(relative: str) -> set[str]:
    return set(VARIABLE.findall((ROOT / relative).read_text()))


def main() -> int:
    docs = (ROOT / "docs/configuration.md").read_text()
    version = (ROOT / "VERSION").read_text().strip()
    failures: list[str] = []
    products = (
        ("web", "web/.env.prod.example", "web/compose.yml"),
        ("ocr", "ocr/.env.example", "ocr/compose.yml"),
    )
    for product, example, compose in products:
        example_variables = env_keys(example)
        compose_variables = compose_keys(compose)
        missing_example = sorted(compose_variables - example_variables)
        missing_docs = sorted(
            variable for variable in example_variables | compose_variables if f"`{variable}`" not in docs
        )
        if missing_example:
            failures.append(f"{product}: Compose variables missing from {example}: {', '.join(missing_example)}")
        if missing_docs:
            failures.append(f"{product}: variables missing from docs/configuration.md: {', '.join(missing_docs)}")

    release_tags = {
        "web/.env.prod.example": "ARCHERO_IMAGE_TAG",
        "ocr/.env.example": "ARCHERO_OCR_IMAGE_TAG",
    }
    for example, variable in release_tags.items():
        values = {
            line.split("=", 1)[0]: line.split("=", 1)[1]
            for line in (ROOT / example).read_text().splitlines()
            if ENV_LINE.match(line)
        }
        if values.get(variable) != version:
            failures.append(f"{example}: {variable} must match VERSION ({version})")

    if failures:
        print("Configuration contract failures:", *[f"- {item}" for item in failures], sep="\n", file=sys.stderr)
        return 1
    print("Configuration contract check passed: Compose, examples, and documentation agree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
