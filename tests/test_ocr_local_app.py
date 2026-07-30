import base64
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image

from observer.ocr.local_app import (
    LocalOcrError,
    configured_target_public,
    day_payload,
    load_targets,
    merge_reviewed_roster,
    move_capture_to_trash,
    selected_capture_paths,
    store_uploaded_images,
    update_remote_target,
)
from observer.pipeline.guild_member_ocr import RosterEntry


def png_data(width: int = 20, height: int = 30) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="PNG")
    return output.getvalue()


class LocalOcrAppTests(unittest.TestCase):
    def test_reviewed_member_ids_are_reused_by_later_extractions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            outbox = Path(directory)
            (outbox / "2026-07-29.json").write_text(
                json.dumps({
                    "members": [
                        {
                            "playerId": "119965772",
                            "name": "Papixl",
                            "power": 834600,
                        }
                    ]
                }),
                encoding="utf-8",
            )
            remote_roster = [
                RosterEntry(player_id="old-id", name="Papixl", power_hint=None),
                RosterEntry(player_id="119982936", name="Pignouf", power_hint=1670000),
            ]

            merged = merge_reviewed_roster(remote_roster, outbox)

        self.assertEqual(
            [(entry.player_id, entry.name) for entry in merged],
            [("119965772", "Papixl"), ("119982936", "Pignouf")],
        )
        self.assertEqual(merged[0].power_hint, 834600)

    def test_loads_named_remote_targets_without_exposing_them(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text(
                json.dumps({
                    "preprod": {
                        "label": "Pre-production",
                        "url": "https://preprod.guild.internal",
                        "ingestionToken": "a" * 32,
                        "cfAccessClientId": "client",
                        "cfAccessClientSecret": "secret",
                    }
                }),
                encoding="utf-8",
            )

            targets = load_targets(path)

        self.assertEqual(targets["preprod"]["url"], "https://preprod.guild.internal")
        self.assertEqual(targets["preprod"]["ingestionToken"], "a" * 32)
        self.assertEqual(targets["preprod"]["mode"], "remote")
        self.assertTrue(targets["preprod"]["configured"])

    def test_local_target_needs_no_url_or_secret_and_cannot_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text(
                json.dumps({"local": {"label": "Local test", "mode": "local"}}),
                encoding="utf-8",
            )

            targets = load_targets(path)
            public = configured_target_public(targets)

        self.assertEqual(targets["local"]["url"], "")
        self.assertTrue(targets["local"]["configured"])
        self.assertFalse(public[0]["publishable"])

    def test_placeholder_remote_target_is_reported_as_unconfigured(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text(
                json.dumps({
                    "preprod": {
                        "url": "https://preprod.archero.example.com",
                        "ingestionToken": "replace-this-placeholder-token",
                    }
                }),
                encoding="utf-8",
            )

            targets = load_targets(path)

        self.assertFalse(targets["preprod"]["configured"])

    def test_updates_a_private_lan_destination_without_exposing_its_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text(
                json.dumps({
                    "local": {"label": "Local", "mode": "local"},
                    "preprod": {
                        "label": "Pre-production",
                        "mode": "remote",
                        "url": "https://preprod.archero.example.com",
                        "ingestionToken": "replace-this-placeholder-token",
                    },
                }),
                encoding="utf-8",
            )
            targets = load_targets(path)

            updated = update_remote_target(
                path,
                targets,
                key="preprod",
                url="http://192.168.1.50:5181",
                ingestion_token="a-real-local-token-123456",
            )
            stored = json.loads(path.read_text(encoding="utf-8"))
            public = configured_target_public(targets)

        self.assertTrue(updated["configured"])
        self.assertEqual(stored["preprod"]["url"], "http://192.168.1.50:5181")
        self.assertNotIn("ingestionToken", public[1])

    def test_stores_uploaded_png_in_the_selected_capture_day(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved = store_uploaded_images(
                root,
                "2026-07-28",
                "guild-members",
                [{"name": "capture.png", "data": base64.b64encode(png_data()).decode("ascii")}],
            )

            self.assertEqual(saved[0]["name"], "members-001.png")
            self.assertEqual(saved[0]["width"], 20)
            self.assertTrue((root / "2026-07-28" / "guild" / "members-001.png").exists())

    def test_replacing_upload_session_archives_old_images_and_restarts_numbering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "2026-07-28" / "guild" / "members-004.png"
            old.parent.mkdir(parents=True)
            old.write_bytes(png_data())

            saved = store_uploaded_images(
                root,
                "2026-07-28",
                "guild-members",
                [{"name": "new.png", "data": base64.b64encode(png_data()).decode("ascii")}],
                replace_existing=True,
            )

            self.assertEqual(saved[0]["name"], "members-001.png")
            self.assertFalse(old.exists())
            self.assertEqual(len(list((root / ".trash" / "2026-07-28" / "guild").glob("*members-004.png"))), 1)

    def test_invalid_replacement_does_not_archive_existing_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "2026-07-28" / "guild" / "members-001.png"
            old.parent.mkdir(parents=True)
            old.write_bytes(png_data())

            with self.assertRaises(LocalOcrError):
                store_uploaded_images(
                    root,
                    "2026-07-28",
                    "guild-members",
                    [{"name": "bad.png", "data": base64.b64encode(b"bad").decode("ascii")}],
                    replace_existing=True,
                )

            self.assertTrue(old.exists())

    def test_rejects_non_png_uploads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(LocalOcrError):
                store_uploaded_images(
                    Path(directory),
                    "2026-07-28",
                    "guild-boss",
                    [{"name": "fake.png", "data": base64.b64encode(b"not-png").decode("ascii")}],
                )

    def test_day_payload_reports_images_and_reviewed_batch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            captures = root / "captures"
            outbox = root / "outbox"
            (captures / "2026-07-28" / "boss").mkdir(parents=True)
            (captures / "2026-07-28" / "boss" / "boss-001.png").write_bytes(png_data())
            outbox.mkdir()
            (outbox / "2026-07-28.json").write_text("{}", encoding="utf-8")

            payload = day_payload(captures, outbox, "2026-07-28")

        self.assertTrue(payload["batchReady"])
        self.assertEqual(payload["images"][0]["kind"], "guild-boss")

    def test_extraction_uses_only_explicitly_selected_images(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            guild = root / "2026-07-28" / "guild"
            boss = root / "2026-07-28" / "boss"
            guild.mkdir(parents=True)
            boss.mkdir(parents=True)
            selected = guild / "members-001.png"
            selected.write_bytes(png_data())
            (guild / "members-002.png").write_bytes(png_data())
            (boss / "boss-001.png").write_bytes(png_data())

            members, bosses = selected_capture_paths(
                root,
                "2026-07-28",
                [
                    {"kind": "guild-members", "name": selected.name},
                ],
            )

        self.assertEqual(members, [selected])
        self.assertEqual(bosses, [])

    def test_extraction_rejects_an_empty_selection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(LocalOcrError, "select between 1"):
                selected_capture_paths(Path(directory), "2026-07-28", [])

    def test_extraction_rejects_mixed_guild_and_boss_images(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            guild = root / "2026-07-28" / "guild"
            boss = root / "2026-07-28" / "boss"
            guild.mkdir(parents=True)
            boss.mkdir(parents=True)
            (guild / "members-001.png").write_bytes(png_data())
            (boss / "boss-001.png").write_bytes(png_data())

            with self.assertRaisesRegex(LocalOcrError, "two separate batches"):
                selected_capture_paths(
                    root,
                    "2026-07-28",
                    [
                        {"kind": "guild-members", "name": "members-001.png"},
                        {"kind": "guild-boss", "name": "boss-001.png"},
                    ],
                )

    def test_removing_an_image_moves_it_to_recoverable_trash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "2026-07-28" / "guild" / "members-001.png"
            source.parent.mkdir(parents=True)
            source.write_bytes(png_data())

            destination = move_capture_to_trash(
                root,
                "2026-07-28",
                "guild-members",
                source.name,
                timestamp="test",
            )

            self.assertFalse(source.exists())
            self.assertEqual(destination, root / ".trash" / "2026-07-28" / "guild" / "test-members-001.png")
            self.assertTrue(destination.exists())


if __name__ == "__main__":
    unittest.main()
