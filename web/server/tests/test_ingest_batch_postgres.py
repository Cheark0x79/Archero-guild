import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

import archero_guild.storage.ingest_batch as ingest_module
from archero_guild.storage.clear_synthetic_data import SyntheticDataClearError, clear_synthetic_data
from archero_guild.storage.ingest_batch import ingest_batch


TEST_DSN = os.environ.get("ARCHERO_TEST_DATABASE_URL")


def integration_batch(*, idempotency_key: str = "2099-01-05:integration-test") -> dict:
    return {
        "schemaVersion": 1,
        "captureDate": "2099-01-05",
        "generatedAt": "2099-01-05T20:15:00+01:00",
        "agentVersion": "integration-test",
        "idempotencyKey": idempotency_key,
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
                "playerId": "999000001",
                "name": "Integration Test",
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
                "playerId": "999000001",
                "name": "Integration Test",
                "rawName": "Integration Test",
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


@unittest.skipUnless(TEST_DSN, "ARCHERO_TEST_DATABASE_URL is required for PostgreSQL integration tests")
class IngestBatchPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        database_name = urlparse(TEST_DSN).path.lstrip("/")
        if not database_name.endswith("_test"):
            raise RuntimeError("refusing to run destructive integration tests outside a *_test database")

        import psycopg

        schema = Path("ocr/app/archero_guild/storage/schema.sql").read_text(encoding="utf-8")
        with psycopg.connect(TEST_DSN, autocommit=True) as connection:
            connection.execute(schema, prepare=False)

    def setUp(self) -> None:
        self._truncate()

    def tearDown(self) -> None:
        self._truncate()

    def test_ingestion_is_transactional_and_idempotent(self) -> None:
        batch = integration_batch()

        first = ingest_batch(batch, TEST_DSN)
        replay = ingest_batch(batch, TEST_DSN)

        self.assertFalse(first["replayed"])
        self.assertEqual(first["status"], "published")
        self.assertTrue(replay["replayed"])
        self.assertEqual(first["id"], replay["id"])

        import psycopg

        with psycopg.connect(TEST_DSN) as connection:
            remote_count = connection.execute(
                "SELECT count(*) FROM remote_import_batches WHERE idempotency_key = %s",
                (batch["idempotencyKey"],),
            ).fetchone()[0]
            metric_count = connection.execute(
                """
                SELECT count(*)
                FROM member_metrics mm
                JOIN guild_snapshots gs ON gs.id = mm.snapshot_id
                WHERE gs.capture_date = %s
                """,
                (batch["captureDate"],),
            ).fetchone()[0]
            boss_count = connection.execute(
                "SELECT count(*) FROM boss_daily_results WHERE capture_date = %s",
                (batch["captureDate"],),
            ).fetchone()[0]
            stored_payload = connection.execute(
                "SELECT payload FROM remote_import_batches WHERE idempotency_key = %s",
                (batch["idempotencyKey"],),
            ).fetchone()[0]

        self.assertEqual(remote_count, 1)
        self.assertEqual(metric_count, 1)
        self.assertEqual(boss_count, 1)
        self.assertEqual(stored_payload["members"][0]["playerId"], "999000001")

    def test_failure_after_combined_persistence_rolls_back_every_scope(self) -> None:
        batch = integration_batch(idempotency_key="2099-01-05:rollback-test")
        persist = ingest_module.persist_import_report_in_connection

        def persist_then_fail(*args, **kwargs):
            persist(*args, **kwargs)
            raise RuntimeError("simulated failure after persistence")

        with patch.object(ingest_module, "persist_import_report_in_connection", side_effect=persist_then_fail):
            with self.assertRaisesRegex(RuntimeError, "simulated failure"):
                ingest_batch(batch, TEST_DSN)

        import psycopg

        with psycopg.connect(TEST_DSN) as connection:
            counts = {
                table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                for table in (
                    "remote_import_batches",
                    "guild_snapshots",
                    "member_metrics",
                    "boss_daily_results",
                )
            }

        self.assertEqual(counts, {
            "remote_import_batches": 0,
            "guild_snapshots": 0,
            "member_metrics": 0,
            "boss_daily_results": 0,
        })

    def test_clear_synthetic_data_removes_an_exclusively_synthetic_batch(self) -> None:
        batch = integration_batch(idempotency_key="synthetic-web-admin-v1:baseline:2099-01-05")
        batch["agentVersion"] = "synthetic-web-admin-v1-baseline"
        batch["members"][0].update({
            "playerId": "900000001",
            "name": "DemoAstra01",
            "source": "synthetic/members-2099-01-05.png row 0",
        })
        batch["bossRankings"][0].update({
            "playerId": "900000001",
            "name": "DemoAstra01",
            "rawName": "DemoAstra01",
            "source": "synthetic/boss-2099-01-05.png podium 1",
        })
        batch["sourceImages"][0]["sourceName"] = "synthetic-guild-members-20990105.png"
        batch["sourceImages"][1]["sourceName"] = "synthetic-guild-boss-20990105.png"
        ingest_batch(batch, TEST_DSN)

        cleared = clear_synthetic_data(TEST_DSN)

        self.assertEqual(cleared, {"members": 1, "days": 1, "bossResults": 1, "importBatches": 1})

    def test_clear_synthetic_data_refuses_any_non_synthetic_batch(self) -> None:
        ingest_batch(integration_batch(), TEST_DSN)

        with self.assertRaisesRegex(SyntheticDataClearError, "not exclusively synthetic"):
            clear_synthetic_data(TEST_DSN)

    @staticmethod
    def _truncate() -> None:
        import psycopg

        with psycopg.connect(TEST_DSN) as connection:
            connection.execute(
                """
                TRUNCATE TABLE
                    remote_import_batches,
                    boss_daily_results,
                    unmatched_member_metrics,
                    member_metrics,
                    guild_snapshots,
                    import_reports,
                    screenshots,
                    capture_batches,
                    member_identity_links,
                    member_names,
                    guild_members
                RESTART IDENTITY CASCADE
                """
            )
            connection.commit()


if __name__ == "__main__":
    unittest.main()
