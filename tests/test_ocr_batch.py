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


if __name__ == "__main__":
    unittest.main()
