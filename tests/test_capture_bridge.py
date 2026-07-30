import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from observer.automation.capture_bridge import CaptureBridgeClient
from observer.automation.capture_bridge import CaptureBridgeError


class CaptureBridgeTests(unittest.TestCase):
    def test_bridge_writes_request_and_accepts_response(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_root = Path(directory)
            bridge_dir = project_root / "data" / "capture-bridge"
            output_path = project_root / "screenshots" / "raw" / "2026-07-28" / "guild" / "members-001.png"
            observed: dict[str, object] = {}

            def worker() -> None:
                requests_dir = bridge_dir / "requests"
                for _ in range(100):
                    requests = list(requests_dir.glob("*.json")) if requests_dir.exists() else []
                    if requests:
                        request = json.loads(requests[0].read_text(encoding="utf-8"))
                        observed.update(request)
                        output_path.parent.mkdir(parents=True)
                        output_path.write_bytes(b"\x89PNG\r\n\x1a\nbridge")
                        responses_dir = bridge_dir / "responses"
                        responses_dir.mkdir(parents=True, exist_ok=True)
                        response_path = responses_dir / requests[0].name
                        response_path.write_text(
                            json.dumps({"id": request["id"], "ok": True}),
                            encoding="utf-8",
                        )
                        return
                    time.sleep(0.005)

            thread = threading.Thread(target=worker)
            thread.start()
            client = CaptureBridgeClient(
                bridge_dir,
                serial="127.0.0.1:5555",
                timeout_seconds=2,
                poll_interval_seconds=0.005,
                project_root=project_root,
            )

            result = client.screenshot(output_path)
            thread.join(timeout=2)

            self.assertEqual(result, output_path)
            self.assertEqual(observed["output_path"], "screenshots/raw/2026-07-28/guild/members-001.png")
            self.assertEqual(observed["kind"], "guild-members")
            self.assertEqual(observed["serial"], "127.0.0.1:5555")
            self.assertEqual(list((bridge_dir / "requests").glob("*.json")), [])
            self.assertEqual(list((bridge_dir / "responses").glob("*.json")), [])

    def test_bridge_surfaces_agent_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_root = Path(directory)
            bridge_dir = project_root / "bridge"
            output_path = project_root / "screenshots" / "raw" / "2026-07-28" / "boss" / "boss-001.png"

            def worker() -> None:
                requests_dir = bridge_dir / "requests"
                for _ in range(100):
                    requests = list(requests_dir.glob("*.json")) if requests_dir.exists() else []
                    if requests:
                        request = json.loads(requests[0].read_text(encoding="utf-8"))
                        responses_dir = bridge_dir / "responses"
                        responses_dir.mkdir(parents=True, exist_ok=True)
                        (responses_dir / requests[0].name).write_text(
                            json.dumps({"id": request["id"], "ok": False, "error": "BlueStacks is not connected"}),
                            encoding="utf-8",
                        )
                        return
                    time.sleep(0.005)

            thread = threading.Thread(target=worker)
            thread.start()
            client = CaptureBridgeClient(
                bridge_dir,
                timeout_seconds=2,
                poll_interval_seconds=0.005,
                project_root=project_root,
            )

            with self.assertRaisesRegex(CaptureBridgeError, "BlueStacks is not connected"):
                client.screenshot(output_path)
            thread.join(timeout=2)
