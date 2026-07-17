from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


USER_ID_PATTERN = re.compile(r"\d{8,15}")


class OcrDecision(StrEnum):
    ACCEPTED = "accepted"
    COMPARE_WITH_HISTORY = "compare_with_history"
    REVIEW_REQUIRED = "review_required"
    REJECTED = "rejected"


@dataclass(frozen=True)
class OcrResult:
    value: str
    confidence: int


def validate_user_id(value: str) -> str:
    normalized = "".join(character for character in value if character.isdigit())
    if not USER_ID_PATTERN.fullmatch(normalized):
        raise ValueError(f"Invalid Archero user ID: {value!r}")
    return normalized


def clean_integer(value: str) -> int:
    normalized = "".join(character for character in value if character.isdigit())
    if not normalized:
        raise ValueError(f"Invalid integer OCR value: {value!r}")
    return int(normalized)


def decide_ocr_result(
    result: OcrResult,
    *,
    min_auto_confidence: int,
    min_history_confidence: int,
    is_possible: bool = True,
) -> OcrDecision:
    if not is_possible:
        return OcrDecision.REJECTED
    if result.confidence >= min_auto_confidence:
        return OcrDecision.ACCEPTED
    if result.confidence >= min_history_confidence:
        return OcrDecision.COMPARE_WITH_HISTORY
    return OcrDecision.REVIEW_REQUIRED

