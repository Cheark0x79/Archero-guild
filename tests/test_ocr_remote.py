import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from observer.ocr.remote import RemoteOcrError, _read_reviewed_batch, _roster_entries, run_day


class RemoteOcrTests(unittest.TestCase):
    def test_builds_roster_entries_from_remote_member_payload(self) -> None:
        roster = _roster_entries(
            [
                {
                    "playerId": "119950325",
                    "name": "斯斯雞預料",
                    "metrics": {"power": 1_160_000},
                }
            ]
        )

        self.assertEqual(roster[0].player_id, "119950325")
        self.assertEqual(roster[0].name, "斯斯雞預料")
        self.assertEqual(roster[0].power_hint, 1_160_000)

    def test_rejects_a_non_array_remote_roster(self) -> None:
        with self.assertRaises(RemoteOcrError):
            _roster_entries({"playerId": "1"})

    def test_validation_is_the_safe_default_before_publication(self) -> None:
        batch = {
            "schemaVersion": 1,
            "captureDate": "2026-07-28",
            "generatedAt": "2026-07-28T00:00:00+02:00",
            "agentVersion": "test",
            "idempotencyKey": "2026-07-28:" + "a" * 64,
            "sourceImages": [],
            "members": [],
            "bossRankings": [],
            "quality": {"status": "pass", "coverage": 1, "completeness": 1, "warnings": []},
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "2026-07-28.json"
            with (
                patch("observer.ocr.remote.fetch_roster") as fetch_roster,
                patch("observer.ocr.remote.build_day_batch", return_value=batch),
                patch(
                    "observer.ocr.remote.publish_batch",
                    return_value={"validated": True, "published": False},
                ) as publish_batch,
            ):
                fetch_roster.return_value = [_roster_entries([{"playerId": "1", "name": "One"}])[0]]
                result = run_day(
                    capture_date="2026-07-28",
                    screenshots_root=Path(directory),
                    output=output,
                    target="http://127.0.0.1:5181",
                    token="secret",
                    agent_version="test",
                    publish=False,
                )
                written_batch = json.loads(output.read_text(encoding="utf-8"))

        self.assertTrue(result["validated"])
        self.assertFalse(result["published"])
        self.assertEqual(written_batch, batch)
        self.assertTrue(publish_batch.call_args.kwargs["validate_only"])

    def test_publication_reuses_the_reviewed_outbox_without_running_ocr(self) -> None:
        batch = {
            "schemaVersion": 1,
            "captureDate": "2026-07-28",
            "quality": {"status": "pass", "coverage": 1, "completeness": 1, "warnings": []},
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "2026-07-28.json"
            output.write_text(json.dumps(batch), encoding="utf-8")
            with (
                patch("observer.ocr.remote.fetch_roster") as fetch_roster,
                patch("observer.ocr.remote.build_day_batch") as build_day_batch,
                patch(
                    "observer.ocr.remote.publish_batch",
                    return_value={"validated": True, "published": True},
                ) as publish_batch,
            ):
                result = run_day(
                    capture_date="2026-07-28",
                    screenshots_root=Path(directory),
                    output=output,
                    target="http://127.0.0.1:5181",
                    token="secret",
                    agent_version="test",
                    publish=True,
                )

        self.assertTrue(result["published"])
        fetch_roster.assert_not_called()
        build_day_batch.assert_not_called()
        self.assertEqual(publish_batch.call_args.args[0], batch)
        self.assertFalse(publish_batch.call_args.kwargs["validate_only"])

    def test_rejects_a_reviewed_batch_for_another_date(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "batch.json"
            output.write_text(
                json.dumps({"captureDate": "2026-07-27", "quality": {}}),
                encoding="utf-8",
            )

            with self.assertRaises(RemoteOcrError):
                _read_reviewed_batch(output, "2026-07-28")


if __name__ == "__main__":
    unittest.main()
