import tempfile
import unittest
from pathlib import Path

from observer.ocr.batch import build_import_batch


class OcrBatchTests(unittest.TestCase):
    def test_builds_deterministic_idempotent_batch(self) -> None:
        result = {
            "input": {"width": 1080, "height": 1920},
            "detection": {"rowCount": 1},
            "rows": [{
                "playerId": "123",
                "name": "Alice",
                "role": "member",
                "power": 1000000,
                "contribution7d": 500,
                "bossAttacks": 2,
                "lastActivityDays": 0,
                "source": "members-001.png row 0",
                "rawName": "Alice",
                "matchScore": 1,
            }],
            "quality": {
                "status": "pass",
                "expectedRows": 1,
                "usefulRows": 1,
                "completeRows": 1,
                "coverage": 1,
                "completeness": 1,
                "warnings": [],
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "members-001.png"
            image.write_bytes(b"png fixture")
            first = build_import_batch(
                [("guild-members", image, result)],
                capture_date="2026-07-29",
                agent_version="abc",
                generated_at="2026-07-29T20:00:00Z",
            )
            second = build_import_batch(
                [("guild-members", image, result)],
                capture_date="2026-07-29",
                agent_version="abc",
                generated_at="2026-07-29T20:00:00Z",
            )

        self.assertEqual(first["idempotencyKey"], second["idempotencyKey"])
        self.assertEqual(first["quality"]["status"], "pass")
        self.assertEqual(first["members"][0]["name"], "Alice")

    def test_attaches_best_guild_overview_only_from_member_scans(self) -> None:
        first_result = {
            "input": {"width": 1080, "height": 1920},
            "detection": {"rowCount": 0},
            "rows": [],
            "guildStats": {"guildName": "Example", "level": 7, "memberCount": 41},
            "quality": {"expectedRows": 0, "usefulRows": 0, "completeRows": 0, "warnings": []},
        }
        better_result = {
            **first_result,
            "guildStats": {
                "guildName": "Example", "guildId": "123", "level": 7,
                "memberCount": 41, "memberCapacity": 42, "expeditionPoints": 825,
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            one = Path(directory) / "members-001.png"
            two = Path(directory) / "members-002.png"
            one.write_bytes(b"first")
            two.write_bytes(b"second")
            batch = build_import_batch(
                [("guild-members", one, first_result), ("guild-members", two, better_result)],
                capture_date="2026-08-09", agent_version="test",
            )

        self.assertEqual(batch["guildStats"]["guildId"], "123")
        self.assertEqual(batch["guildStats"]["expeditionPoints"], 825)

    def test_keeps_a_member_row_when_ocr_detects_no_name(self) -> None:
        result = {
            "input": {"width": 1080, "height": 1920},
            "detection": {"rowCount": 1},
            "rows": [{
                "playerId": None,
                "name": None,
                "source": "members-001.png row 3",
                "rawName": "",
                "power": 900000,
                "matchScore": 0,
            }],
            "quality": {
                "expectedRows": 1,
                "usefulRows": 1,
                "completeRows": 0,
                "warnings": ["Name requires review."],
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "members-001.png"
            image.write_bytes(b"png fixture")
            batch = build_import_batch(
                [("guild-members", image, result)],
                capture_date="2026-07-29",
                agent_version="test",
            )

        self.assertEqual(len(batch["members"]), 1)
        self.assertIsNone(batch["members"][0]["name"])
        self.assertEqual(batch["quality"]["status"], "review")


if __name__ == "__main__":
    unittest.main()
