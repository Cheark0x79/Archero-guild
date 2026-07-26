import json
import tempfile
import unittest
from contextlib import redirect_stderr
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from observer.capture import capture_today
from observer.capture import capture_paths
from observer.capture import main
from observer.capture import next_capture_path


class FakeScreenshotClient:
    def __init__(self) -> None:
        self.paths: list[Path] = []

    def screenshot(self, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"png")
        self.paths.append(output_path)
        return output_path


class CaptureTests(unittest.TestCase):
    def test_next_capture_path_uses_dated_kind_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            day_dir = Path(directory) / "2026-07-16"
            day_dir.mkdir()
            (day_dir / "guild-members-001.png").write_bytes(b"first")
            (day_dir / "guild").mkdir()
            (day_dir / "guild" / "members-003.png").write_bytes(b"third")
            (day_dir / "guild-boss-001.png").write_bytes(b"boss")

            path = next_capture_path(day_dir, "guild-members")

        self.assertEqual(path, day_dir / "guild" / "members-004.png")

    def test_capture_paths_reads_legacy_and_nested_layouts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            day_dir = Path(directory) / "2026-07-16"
            (day_dir / "guild").mkdir(parents=True)
            (day_dir / "guild-members-001.png").write_bytes(b"legacy")
            (day_dir / "guild" / "members-002.png").write_bytes(b"nested")

            paths = capture_paths(day_dir, "guild-members")

        self.assertEqual([path.name for path in paths], ["guild-members-001.png", "members-002.png"])

    def test_capture_today_writes_using_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FakeScreenshotClient()
            result = capture_today(
                "guild-boss",
                root=Path(directory),
                capture_date="2026-07-16",
                client=client,
            )

            self.assertEqual(result.path, Path(directory) / "2026-07-16" / "boss" / "boss-001.png")
            self.assertEqual(client.paths, [result.path])
            self.assertTrue(result.path.exists())

    def test_cli_dry_run_outputs_next_path_without_creating_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stdout = StringIO()
            with redirect_stdout(stdout):
                exit_code = main(["guild-members", "--root", directory, "--date", "2026-07-16", "--dry-run"])

            payload = json.loads(stdout.getvalue())

        self.assertEqual(exit_code, 0)
        self.assertEqual(Path(payload["path"]), Path(directory) / "2026-07-16" / "guild" / "members-001.png")
        self.assertTrue(payload["dry_run"])

    def test_cli_rejects_invalid_date(self) -> None:
        stderr = StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as error:
            main(["guild-members", "--date", "16-07-2026", "--dry-run"])

        self.assertEqual(error.exception.code, 1)
        self.assertIn("YYYY-MM-DD", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
