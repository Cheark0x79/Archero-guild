import os
import unittest
from unittest.mock import Mock, patch

from observer.storage.persistence import _guard_replacement_size


class PersistenceSafetyTests(unittest.TestCase):
    def test_rejects_large_replacement_drop(self) -> None:
        cursor = Mock()
        cursor.fetchone.return_value = (20,)
        with self.assertRaisesRegex(RuntimeError, "refusing to replace 20"):
            _guard_replacement_size(cursor, "SELECT count(*)", "2026-07-25", 5, "member metrics")

    def test_explicit_override_allows_replacement(self) -> None:
        cursor = Mock()
        with patch.dict(os.environ, {"ARCHERO_ALLOW_PARTIAL_REPLACEMENT": "1"}):
            _guard_replacement_size(cursor, "SELECT count(*)", "2026-07-25", 1, "member metrics")
        cursor.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
