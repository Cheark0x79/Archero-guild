import json
import tempfile
import unittest
from pathlib import Path

from observer.ocr.review import ReviewError, add_batch_row, apply_batch_edit, clear_reviewed_data, delete_batch_row


def sample_batch() -> dict:
    return {
        "schemaVersion": 1,
        "captureDate": "2026-07-29",
        "generatedAt": "2026-07-29T12:00:00+02:00",
        "agentVersion": "test",
        "idempotencyKey": "2026-07-29:" + "a" * 64,
        "sourceImages": [],
        "members": [{
            "playerId": None,
            "rawName": "Anxlety",
            "name": None,
            "role": "member",
            "power": 1_420_000,
            "powerText": "1.42M",
            "contribution7d": 0,
            "bossAttacks": 0,
            "lastActivityDays": 1,
            "activityText": "1 d 10 h",
            "source": "members-001.png row 0",
            "matchScore": 0,
        }],
        "bossRankings": [],
        "quality": {
            "status": "review",
            "coverage": 1,
            "completeness": 0,
            "warnings": ["Name missing."],
        },
    }


class OcrReviewTests(unittest.TestCase):
    def test_edit_updates_batch_audit_quality_and_idempotency(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            batch_path = Path(directory) / "2026-07-29.json"
            corrections_path = Path(directory) / "corrections" / "2026-07-29.json"
            original = sample_batch()
            batch_path.write_text(json.dumps(original), encoding="utf-8")

            batch, corrections = apply_batch_edit(
                batch_path,
                corrections_path,
                capture_date="2026-07-29",
                category="members",
                row_index=0,
                field="name",
                value="anxiety",
            )

        self.assertEqual(batch["members"][0]["name"], "anxiety")
        self.assertEqual(batch["quality"]["status"], "pass")
        self.assertEqual(batch["quality"]["completeness"], 1)
        self.assertNotEqual(batch["idempotencyKey"], original["idempotencyKey"])
        self.assertEqual(corrections["entries"][0]["before"], None)
        self.assertEqual(corrections["entries"][0]["after"], "anxiety")

    def test_edit_parses_visible_game_values_into_numeric_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            batch_path = Path(directory) / "2026-07-29.json"
            corrections_path = Path(directory) / "corrections.json"
            batch = sample_batch()
            batch["members"][0]["name"] = "anxiety"
            batch["sourceImages"] = [{"kind": "guild-members", "sourceName": "members-001.png", "detectedRows": 1}]
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            updated, _ = apply_batch_edit(
                batch_path,
                corrections_path,
                capture_date="2026-07-29",
                category="members",
                row_index=0,
                field="activityText",
                value="01d 10h",
            )

        self.assertEqual(updated["members"][0]["activityText"], "1 d 10 h")
        self.assertEqual(updated["members"][0]["lastActivityDays"], 1)

    def test_rejects_invalid_power_without_changing_the_batch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            batch_path = Path(directory) / "2026-07-29.json"
            corrections_path = Path(directory) / "corrections.json"
            original = sample_batch()
            batch_path.write_text(json.dumps(original), encoding="utf-8")

            with self.assertRaises(ReviewError):
                apply_batch_edit(
                    batch_path,
                    corrections_path,
                    capture_date="2026-07-29",
                    category="members",
                    row_index=0,
                    field="powerText",
                    value="not a power",
                )

            stored = json.loads(batch_path.read_text(encoding="utf-8"))

        self.assertEqual(stored, original)

    def test_rejects_editing_a_member_to_a_duplicate_player_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "2026-07-29.json"
            corrections_path = root / "corrections.json"
            batch = sample_batch()
            other = dict(batch["members"][0])
            other.update({"playerId": "222", "rawName": "Other", "name": "Other"})
            batch["members"][0]["playerId"] = "111"
            batch["members"] = [batch["members"][0], other]
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            with self.assertRaisesRegex(ReviewError, "already used"):
                apply_batch_edit(
                    batch_path,
                    corrections_path,
                    capture_date="2026-07-29",
                    category="members",
                    row_index=0,
                    field="playerId",
                    value="222",
                )

            stored = json.loads(batch_path.read_text(encoding="utf-8"))

        self.assertEqual(stored["members"][0]["playerId"], "111")

    def test_clear_removes_only_batch_and_corrections(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "2026-07-29.json"
            corrections_path = root / "corrections" / "2026-07-29.json"
            screenshot = root / "members-001.png"
            batch_path.write_text("{}", encoding="utf-8")
            corrections_path.parent.mkdir()
            corrections_path.write_text("{}", encoding="utf-8")
            screenshot.write_bytes(b"png")

            removed = clear_reviewed_data(batch_path, corrections_path, "2026-07-29")

            self.assertEqual(removed, {"batch": True, "corrections": True})
            self.assertTrue(screenshot.exists())

    def test_delete_rejects_an_invented_row_and_records_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "2026-07-29.json"
            corrections_path = root / "corrections" / "2026-07-29.json"
            batch = sample_batch()
            batch["sourceImages"] = [{
                "kind": "guild-members",
                "sourceName": "members-001.png",
                "detectedRows": 2,
            }]
            complete_row = dict(batch["members"][0])
            complete_row.update({
                "name": "anxiety",
                "role": "member",
                "power": 1_420_000,
                "contribution7d": 0,
                "bossAttacks": 0,
                "lastActivityDays": 1,
            })
            invented_row = {
                **complete_row,
                "name": None,
                "rawName": "invented OCR",
                "source": "members-001.png row 1",
            }
            batch["members"] = [complete_row, invented_row]
            batch["quality"] = {
                "status": "review",
                "coverage": 1,
                "completeness": 0.5,
                "warnings": ["one incomplete row"],
            }
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            updated, corrections = delete_batch_row(
                batch_path,
                corrections_path,
                capture_date="2026-07-29",
                category="members",
                row_index=1,
            )

        self.assertEqual(len(updated["members"]), 1)
        self.assertEqual(updated["sourceImages"][0]["detectedRows"], 1)
        self.assertEqual(updated["quality"]["status"], "pass")
        self.assertEqual(updated["quality"]["coverage"], 1)
        self.assertEqual(updated["quality"]["completeness"], 1)
        self.assertEqual(corrections["entries"][0]["action"], "delete")
        self.assertEqual(corrections["entries"][0]["before"]["rawName"], "invented OCR")

    def test_adds_a_missing_roster_member_as_an_editable_row(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "2026-07-29.json"
            corrections_path = root / "corrections" / "2026-07-29.json"
            batch = sample_batch()
            batch["members"][0]["name"] = "anxiety"
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            updated, corrections = add_batch_row(
                batch_path,
                corrections_path,
                capture_date="2026-07-29",
                category="members",
                initial={"playerId": "119982797", "name": "Alco123", "power": 995630},
            )

        added = updated["members"][1]
        self.assertEqual(added["playerId"], "119982797")
        self.assertEqual(added["name"], "Alco123")
        self.assertEqual(added["powerText"], "995.63K")
        self.assertEqual(added["source"], "manual review")
        self.assertEqual(updated["quality"]["status"], "review")
        self.assertEqual(corrections["entries"][0]["action"], "add")

    def test_rejects_adding_the_same_member_twice(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "2026-07-29.json"
            corrections_path = root / "corrections.json"
            batch = sample_batch()
            batch["members"][0]["playerId"] = "119982797"
            batch["sourceImages"] = [{"kind": "guild-members", "sourceName": "members-001.png", "detectedRows": 1}]
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            with self.assertRaisesRegex(ReviewError, "already exists"):
                add_batch_row(
                    batch_path,
                    corrections_path,
                    capture_date="2026-07-29",
                    category="members",
                    initial={"playerId": "119982797", "name": "Alco123"},
                )


if __name__ == "__main__":
    unittest.main()
