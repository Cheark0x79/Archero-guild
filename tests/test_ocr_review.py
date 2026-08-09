import json
import tempfile
import unittest
from pathlib import Path

from observer.ocr.review import (
    ReviewError,
    add_batch_row,
    apply_batch_edit,
    clear_reviewed_data,
    confirmed_departure_ids,
    delete_batch_row,
    link_member_identity,
    merge_reviewed_scope,
    prepare_export_batch,
    record_departure_decision,
    refresh_reviewed_batch,
    remove_reviewed_scope,
)


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
    def test_member_capture_overlap_does_not_create_false_missing_rows(self) -> None:
        batch = sample_batch()
        batch["members"][0].update({"playerId": "1", "name": "Anxiety"})
        batch["sourceImages"] = [
            {"kind": "guild-members", "sourceName": "members-1.png", "detectedRows": 5},
            {"kind": "guild-members", "sourceName": "members-2.png", "detectedRows": 5},
        ]

        refresh_reviewed_batch(batch)

        self.assertEqual(batch["quality"]["memberExpectedRows"], 1)
        self.assertEqual(batch["quality"]["memberCoverage"], 1)
        self.assertEqual(batch["quality"]["coverage"], 1)
        self.assertEqual(batch["quality"]["status"], "pass")

    def test_boss_capture_overlap_does_not_require_a_fake_participant(self) -> None:
        batch = sample_batch()
        batch["members"] = []
        batch["sourceImages"] = [
            {"kind": "guild-boss", "sourceName": "boss-1.png", "detectedRows": 8},
            {"kind": "guild-boss", "sourceName": "boss-2.png", "detectedRows": 5},
        ]
        batch["bossRankings"] = [
            {"rank": rank, "name": f"Boss {rank}", "damage": rank, "damageText": str(rank)}
            for rank in range(1, 13)
        ]

        refresh_reviewed_batch(batch)

        self.assertEqual(batch["quality"]["bossExpectedRows"], 12)
        self.assertEqual(batch["quality"]["coverage"], 1)
        self.assertEqual(batch["quality"]["status"], "pass")

    def test_missing_boss_rank_remains_blocking_without_a_fixed_total(self) -> None:
        batch = sample_batch()
        batch["members"] = []
        batch["sourceImages"] = [{"kind": "guild-boss", "sourceName": "boss.png", "detectedRows": 3}]
        batch["bossRankings"] = [
            {"rank": 1, "name": "One", "damage": 1, "damageText": "1"},
            {"rank": 3, "name": "Three", "damage": 3, "damageText": "3"},
        ]

        refresh_reviewed_batch(batch)

        self.assertEqual(batch["quality"]["bossExpectedRows"], 3)
        self.assertEqual(batch["quality"]["coverage"], 0.666667)
        self.assertEqual(batch["quality"]["status"], "review")

    def test_export_date_is_applied_without_mutating_local_review(self) -> None:
        local = sample_batch()
        original_key = local["idempotencyKey"]

        exported = prepare_export_batch(local, "2026-08-08")

        self.assertEqual(local["captureDate"], "2026-07-29")
        self.assertEqual(local["idempotencyKey"], original_key)
        self.assertEqual(exported["captureDate"], "2026-08-08")
        self.assertTrue(exported["idempotencyKey"].startswith("2026-08-08:"))
        self.assertNotEqual(exported["idempotencyKey"], original_key)

    def test_merges_member_and_boss_scopes_into_one_batch(self) -> None:
        members = sample_batch()
        members["sourceImages"] = [{"kind": "guild-members", "sourceName": "members.png", "detectedRows": 1}]
        members["guildStats"] = {"guildName": "Example", "memberCount": 41, "memberCapacity": 42}
        bosses = sample_batch()
        bosses["sourceImages"] = [{"kind": "guild-boss", "sourceName": "boss.png", "detectedRows": 1}]
        bosses["members"] = []
        bosses["bossRankings"] = [{
            "rank": 1, "name": "Alice", "damage": 100, "damageText": "100", "source": "boss.png",
        }]

        merged = merge_reviewed_scope(members, bosses)

        self.assertEqual({image["kind"] for image in merged["sourceImages"]}, {"guild-members", "guild-boss"})
        self.assertEqual(len(merged["members"]), 1)
        self.assertEqual(len(merged["bossRankings"]), 1)
        self.assertEqual(merged["guildStats"]["guildName"], "Example")

    def test_replacing_boss_scope_preserves_reviewed_members(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "batch.json"
            corrections_path = root / "corrections.json"
            batch = sample_batch()
            batch["sourceImages"] = [
                {"kind": "guild-members", "sourceName": "members.png", "detectedRows": 1},
                {"kind": "guild-boss", "sourceName": "boss.png", "detectedRows": 1},
            ]
            batch["bossRankings"] = [{"rank": 1, "name": "Alice", "damage": 100, "damageText": "100", "source": "boss.png"}]
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            remove_reviewed_scope(batch_path, corrections_path, "2026-07-29", "guild-boss")
            stored = json.loads(batch_path.read_text(encoding="utf-8"))

        self.assertEqual(len(stored["members"]), 1)
        self.assertEqual(stored["bossRankings"], [])
        self.assertEqual([image["kind"] for image in stored["sourceImages"]], ["guild-members"])

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
            batch["sourceImages"] = [{
                "kind": "guild-members",
                "sourceName": "members-001.png",
                "detectedRows": 2,
            }]
            batch["quality"]["coverage"] = 0.5
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
        self.assertEqual(updated["quality"]["coverage"], 1)
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

    def test_links_an_existing_ocr_row_without_losing_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "2026-07-29.json"
            corrections_path = root / "corrections" / "2026-07-29.json"
            batch = sample_batch()
            batch["sourceImages"] = [{"kind": "guild-members", "sourceName": "members.png", "detectedRows": 1}]
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            updated, corrections, observed = link_member_identity(
                batch_path,
                corrections_path,
                capture_date="2026-07-29",
                row_index=0,
                player_id="119982797",
                canonical_name="Anxiety",
            )

        row = updated["members"][0]
        self.assertEqual(observed, "Anxlety")
        self.assertEqual(row["playerId"], "119982797")
        self.assertEqual(row["name"], "Anxiety")
        self.assertEqual(row["rawName"], "Anxlety")
        self.assertEqual(row["power"], 1_420_000)
        self.assertEqual(row["contribution7d"], 0)
        self.assertEqual(corrections["entries"][0]["action"], "link")

    def test_rejects_linking_a_player_id_already_used_by_another_row(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch_path = root / "2026-07-29.json"
            corrections_path = root / "corrections.json"
            batch = sample_batch()
            other = dict(batch["members"][0])
            other.update({"playerId": "119982797", "name": "Anxiety", "rawName": "Anxiety"})
            batch["members"].append(other)
            batch_path.write_text(json.dumps(batch), encoding="utf-8")

            with self.assertRaisesRegex(ReviewError, "already used"):
                link_member_identity(
                    batch_path,
                    corrections_path,
                    capture_date="2026-07-29",
                    row_index=0,
                    player_id="119982797",
                    canonical_name="Anxiety",
                )

    def test_departure_decision_is_logged_and_can_be_undone(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            corrections_path = Path(directory) / "corrections" / "2026-07-29.json"

            confirmed = record_departure_decision(
                corrections_path,
                capture_date="2026-07-29",
                player_id="119982797",
                name="FormerPlayer",
                confirmed=True,
            )
            undone = record_departure_decision(
                corrections_path,
                capture_date="2026-07-29",
                player_id="119982797",
                name="FormerPlayer",
                confirmed=False,
            )

        self.assertEqual(confirmed_departure_ids(confirmed), {"119982797"})
        self.assertEqual(confirmed_departure_ids(undone), set())
        self.assertEqual([entry["confirmed"] for entry in undone["entries"]], [True, False])
        self.assertTrue(all(entry["action"] == "departure" for entry in undone["entries"]))


if __name__ == "__main__":
    unittest.main()
