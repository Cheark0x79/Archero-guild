from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class RankingRow:
    rank: int
    name: str
    score: int
    user_id: str | None = None

    @property
    def capture_key(self) -> tuple[int, str, int]:
        return (self.rank, self.name.casefold().strip(), self.score)

    @property
    def stable_key(self) -> str | tuple[int, str, int]:
        return self.user_id if self.user_id else self.capture_key


@dataclass(frozen=True)
class RankingSnapshot:
    ranking: str
    captured_at: datetime
    rows: tuple[RankingRow, ...]


def deduplicate_rows(rows: list[RankingRow]) -> list[RankingRow]:
    seen: set[str | tuple[int, str, int]] = set()
    deduplicated: list[RankingRow] = []
    for row in rows:
        key = row.stable_key
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(row)
    return deduplicated


def should_stop_scrolling(previous_count: int, current_count: int, stagnant_captures: int) -> bool:
    if current_count > previous_count:
        return False
    return stagnant_captures >= 2

