from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from observer.storage.member_identities import assign_identity, list_identity_links, normalize_name, set_member_status


class MemberIdentityTests(unittest.TestCase):
    def test_normalize_name_is_case_and_whitespace_insensitive(self) -> None:
        self.assertEqual(normalize_name("  PIGNOUF\u00a0 "), "pignouf")

    def test_local_identity_assignment_is_persistent_and_replaceable(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"ARCHERO_DATABASE_URL": "", "DATABASE_URL": ""},
        ):
            path = Path(directory) / "member-identities.json"

            first = assign_identity(" Pignouf ", "119982936", data_path=path)
            replacement = assign_identity("PIGNOUF", "119999999", data_path=path)

            self.assertEqual(first["normalizedName"], "pignouf")
            self.assertEqual(replacement["playerId"], "119999999")
            expected = [
                {
                    "normalizedName": "pignouf",
                    "observedName": "PIGNOUF",
                    "playerId": "119999999",
                }
            ]
            self.assertEqual(list_identity_links(data_path=path), expected)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), expected)

            set_member_status("119999999", "left", observed_name="Pignouf", data_path=path)
            self.assertEqual(list_identity_links(data_path=path)[0]["status"], "left")


if __name__ == "__main__":
    unittest.main()
