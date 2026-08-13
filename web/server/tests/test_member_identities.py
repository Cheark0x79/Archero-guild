from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from archero_guild.storage.member_identities import (
    _GUILD_MEMBER_IDENTITY_UPSERT,
    assign_identity,
    edit_member_identity,
    list_identity_links,
    normalize_name,
    rename_unmatched_member,
    set_member_status,
)


class MemberIdentityTests(unittest.TestCase):
    def test_normalize_name_is_case_and_whitespace_insensitive(self) -> None:
        self.assertEqual(normalize_name("  MAPLEFOX\u00a0 "), "maplefox")

    def test_identity_alias_never_overwrites_an_existing_canonical_name(self) -> None:
        self.assertNotIn("current_name = EXCLUDED.current_name", _GUILD_MEMBER_IDENTITY_UPSERT)

    def test_local_identity_assignment_is_persistent_and_replaceable(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"ARCHERO_DATABASE_URL": "", "DATABASE_URL": ""},
        ):
            path = Path(directory) / "member-identities.json"

            first = assign_identity(" MapleFox ", "900000104", data_path=path)
            replacement = assign_identity("MAPLEFOX", "900000199", data_path=path)

            self.assertEqual(first["normalizedName"], "maplefox")
            self.assertEqual(replacement["playerId"], "900000199")
            expected = [
                {
                    "normalizedName": "maplefox",
                    "observedName": "MAPLEFOX",
                    "playerId": "900000199",
                }
            ]
            self.assertEqual(list_identity_links(data_path=path), expected)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), expected)

            set_member_status("900000199", "left", observed_name="MapleFox", data_path=path)
            self.assertEqual(list_identity_links(data_path=path)[0]["status"], "left")

            edited = edit_member_identity("900000199", "900000200", "Maple Fox", data_path=path)
            self.assertEqual(edited["playerId"], "900000200")
            links = list_identity_links(data_path=path)
            self.assertTrue(all(link["playerId"] == "900000200" for link in links))
            self.assertIn("maple fox", {link["normalizedName"] for link in links})

    def test_manual_ocr_name_correction_validates_its_target(self) -> None:
        with self.assertRaisesRegex(ValueError, "YYYY-MM-DD"):
            rename_unmatched_member("28-07-2026", "members-001.png row 2", "YYLsea")
        with self.assertRaisesRegex(ValueError, "source is required"):
            rename_unmatched_member("2026-07-28", " ", "YYLsea")
        with self.assertRaisesRegex(ValueError, "observed name is required"):
            rename_unmatched_member("2026-07-28", "members-001.png row 2", " ")


if __name__ == "__main__":
    unittest.main()
