from __future__ import annotations

import subprocess
from pathlib import Path


class AdbError(RuntimeError):
    pass


class AdbClient:
    def __init__(self, serial: str | None = None) -> None:
        self.serial = serial

    def tap(self, x: int, y: int) -> None:
        self._run("shell", "input", "tap", str(x), str(y))

    def swipe(self, start_x: int, start_y: int, end_x: int, end_y: int, duration_ms: int) -> None:
        self._run(
            "shell",
            "input",
            "swipe",
            str(start_x),
            str(start_y),
            str(end_x),
            str(end_y),
            str(duration_ms),
        )

    def screenshot(self, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        command = self._command("exec-out", "screencap", "-p")
        with output_path.open("wb") as handle:
            result = subprocess.run(command, stdout=handle, stderr=subprocess.PIPE, check=False)
        if result.returncode != 0:
            raise AdbError(result.stderr.decode("utf-8", errors="replace"))
        return output_path

    def _run(self, *args: str) -> None:
        result = subprocess.run(
            self._command(*args),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise AdbError(result.stderr.strip() or result.stdout.strip())

    def _command(self, *args: str) -> list[str]:
        command = ["adb"]
        if self.serial:
            command.extend(["-s", self.serial])
        command.extend(args)
        return command

