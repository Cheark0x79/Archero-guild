import unittest

from observer.storage.ingest_batch import BatchIngestionError, _convert_batch, _validate_batch


def valid_batch():
    return {
        "schemaVersion": 1,
        "captureDate": "2026-07-29",
        "generatedAt": "2026-07-29T20:15:00+02:00",
        "agentVersion": "test-sha",
        "idempotencyKey": "2026-07-29:0123456789abcdef",
        "sourceImages": [
            {
                "kind": "guild-members",
                "sha256": "a" * 64,
                "width": 1440,
                "height": 2560,
                "detectedRows": 1,
                "sourceName": "members.png",
            },
            {
                "kind": "guild-boss",
                "sha256": "b" * 64,
                "width": 1440,
                "height": 2560,
                "detectedRows": 1,
                "sourceName": "boss.png",
            },
        ],
        "members": [
            {
                "playerId": "123",
                "name": "Alice",
                "role": "member",
                "power": 1_000_000,
                "powerText": "1M",
                "contribution7d": 500,
                "bossAttacks": 2,
                "lastActivityDays": 0,
                "activityText": "Online",
                "source": "members.png row 0",
                "matchScore": 1,
            }
        ],
        "bossRankings": [
            {
                "playerId": "123",
                "name": "Alice",
                "rawName": "Alice",
                "rank": 1,
                "damageText": "2.5M",
                "damage": 2_500_000,
                "area": "podium",
                "rowIndex": 0,
                "source": "boss.png podium 1",
            }
        ],
        "quality": {"status": "pass", "coverage": 1, "completeness": 1, "warnings": []},
    }


class IngestBatchTests(unittest.TestCase):
    def test_converts_contract_to_existing_persistence_types(self):
        batch = valid_batch()
        report, roster, members, bosses = _convert_batch(batch)

        self.assertEqual(report.date, "2026-07-29")
        self.assertEqual(report.detected_member_rows, 1)
        self.assertEqual(report.detected_boss_rows, 1)
        self.assertEqual(roster[0].player_id, "123")
        self.assertEqual(members[0].power_text, "1M")
        self.assertEqual(bosses[0].boss_damage_today, 2_500_000)

    def test_rejects_batch_below_quality_gate(self):
        batch = valid_batch()
        batch["quality"]["coverage"] = 0.9

        with self.assertRaisesRegex(BatchIngestionError, "quality gate"):
            _validate_batch(batch)


if __name__ == "__main__":
    unittest.main()
