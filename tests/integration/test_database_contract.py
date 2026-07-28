from __future__ import annotations

import os
import unittest
from pathlib import Path

from observer.storage.export_json import export_dashboard_payload
from observer.storage.rules import read_rules, write_rules


DATABASE_URL = os.environ.get("ARCHERO_INTEGRATION_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "ARCHERO_INTEGRATION_DATABASE_URL is required")
class DatabaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            import psycopg
        except ImportError as exc:  # pragma: no cover - integration image provides it
            raise unittest.SkipTest("psycopg is required") from exc

        cls.psycopg = psycopg
        cls._seed_database()

    @classmethod
    def _seed_database(cls) -> None:
        with cls.psycopg.connect(DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                schema = (Path(__file__).parents[2] / "observer" / "storage" / "schema.sql").read_text(encoding="utf-8")
                cursor.execute(schema, prepare=False)
                cursor.execute(
                    """
                    TRUNCATE TABLE
                        automation_runs,
                        ocr_failures,
                        rule_settings,
                        boss_daily_results,
                        member_metrics,
                        guild_snapshots,
                        import_reports,
                        screenshots,
                        capture_batches,
                        member_names,
                        guild_members
                    RESTART IDENTITY CASCADE
                    """
                )
                cursor.execute(
                    """
                    INSERT INTO guild_members (
                        user_id, current_name, discord_name, discord_linked, status, joined_on, metadata
                    )
                    VALUES (
                        'integration-001', 'Integration Alice', 'alice-test', TRUE,
                        'active', DATE '2026-07-01',
                        '{"searchAliases":["Alice I"],"aliases":["integration hero"]}'::jsonb
                    )
                    """
                )
                cursor.executemany(
                    """
                    INSERT INTO member_names (user_id, name, first_seen_at, last_seen_at)
                    VALUES ('integration-001', %s, %s, %s)
                    """,
                    [
                        ("Old Alice", "2026-06-01T08:00:00+00", "2026-06-30T08:00:00+00"),
                        ("Integration Alice", "2026-07-01T08:00:00+00", "2026-07-28T08:00:00+00"),
                    ],
                )
                cursor.execute(
                    """
                    INSERT INTO capture_batches (capture_date, captured_at, imported_at, source, status)
                    VALUES
                        (DATE '2026-07-01', TIMESTAMPTZ '2026-07-01 08:00:00+00', TIMESTAMPTZ '2026-07-01 08:05:00+00', 'test', 'imported'),
                        (DATE '2026-07-27', TIMESTAMPTZ '2026-07-27 08:00:00+00', TIMESTAMPTZ '2026-07-27 08:05:00+00', 'test', 'imported'),
                        (DATE '2026-07-28', TIMESTAMPTZ '2026-07-28 08:00:00+00', TIMESTAMPTZ '2026-07-28 08:05:00+00', 'test', 'imported')
                    RETURNING id, capture_date
                    """
                )
                batch_ids = {str(capture_date): batch_id for batch_id, capture_date in cursor.fetchall()}
                for capture_date, batch_id in batch_ids.items():
                    cursor.execute(
                        """
                        INSERT INTO import_reports (
                            capture_date, batch_id, report_path, report_payload, front_updated
                        )
                        VALUES (%s, %s, %s, '{}'::jsonb, TRUE)
                        """,
                        (capture_date, batch_id, f"data/imports/{capture_date}.json"),
                    )
                    cursor.execute(
                        """
                        INSERT INTO guild_snapshots (batch_id, capture_date, captured_at, source)
                        VALUES (%s, %s, %s::date + TIME '08:00:00', 'integration-test')
                        RETURNING id
                        """,
                        (batch_id, capture_date, capture_date),
                    )
                    snapshot_id = cursor.fetchone()[0]
                    values = {
                        "2026-07-01": (1_000, 100, 0, 3),
                        "2026-07-27": (1_100, 500, 1, 1),
                        "2026-07-28": (1_200, 700, 2, 0),
                    }[capture_date]
                    cursor.execute(
                        """
                        INSERT INTO member_metrics (
                            snapshot_id, user_id, role, power, contribution_7d,
                            boss_attacks, last_activity_days, verification_note
                        )
                        VALUES (%s, 'integration-001', 'member', %s, %s, %s, %s, 'integration verified')
                        """,
                        (snapshot_id, *values),
                    )
                cursor.execute(
                    """
                    INSERT INTO boss_daily_results (
                        capture_date, boss_key, user_id, player_name, boss_rank,
                        damage_text, damage_value, row_area, row_index
                    )
                    VALUES (
                        DATE '2026-07-28', 'fire-dragon', 'integration-001',
                        'Integration Alice', 1, '1.23K', 1234, 'list', 0
                    )
                    """
                )
                cursor.executemany(
                    "INSERT INTO rule_settings (key, value) VALUES (%s, %s::jsonb)",
                    [
                        ("maxInactiveDays", "3"),
                        ("minContribution7d", "500"),
                        ("minPowerGrowth14dPercent", "1"),
                        ("minBossTries", "2"),
                        ("newMemberGraceDays", "7"),
                        ("memberCapacity", "40"),
                    ],
                )
            connection.commit()

    def test_real_database_export_contains_only_seeded_live_data(self) -> None:
        payload = export_dashboard_payload(DATABASE_URL)

        self.assertEqual([member["playerId"] for member in payload["guildRoster"]], ["integration-001"])
        self.assertEqual(len(payload["memberSnapshots"]), 1)
        self.assertNotIn("119934456", {member["playerId"] for member in payload["guildRoster"]})
        self.assertEqual(payload["rules"]["memberCapacity"], 40)
        self.assertEqual(len(payload["bossDefinitions"]), 7)
        self.assertEqual(payload["dailyBossRawSnapshots"][0]["bossKey"], "fire-dragon")
        self.assertEqual(payload["guildRoster"][0]["previousNames"], ["Old Alice"])
        self.assertEqual(payload["guildRoster"][0]["searchAliases"], ["Alice I", "integration hero"])

    def test_real_database_history_derives_member_metrics(self) -> None:
        member = export_dashboard_payload(DATABASE_URL)["memberSnapshots"][0]

        self.assertEqual(member["power"], 1_200)
        self.assertEqual(member["powerDelta"], 100)
        self.assertEqual(member["contributionDelta"], 200)
        self.assertEqual(member["bossAttacksDelta"], 1)
        self.assertEqual(member["bossDamageToday"], 1234)
        self.assertEqual(member["power14dPercent"], 20.0)
        self.assertEqual(member["previousSnapshot"]["lastSeenAt"], "2026-07-27")

    def test_rules_round_trip_through_postgresql(self) -> None:
        rules = read_rules(DATABASE_URL)
        rules["memberCapacity"] = 35

        stored = write_rules(DATABASE_URL, rules)

        self.assertEqual(stored["memberCapacity"], 35)
        self.assertEqual(read_rules(DATABASE_URL)["memberCapacity"], 35)
