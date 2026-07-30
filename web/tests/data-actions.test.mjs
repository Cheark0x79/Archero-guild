import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  observerEnv,
  observerPythonCommand,
  validateCaptureDate,
} from "../app/api/data/actions.js";

test("validateCaptureDate validates the calendar instead of only the shape", () => {
  assert.equal(validateCaptureDate("2026-07-28"), true);
  assert.equal(validateCaptureDate("2024-02-29"), true);
  assert.equal(validateCaptureDate("2026-02-29"), false);
  assert.equal(validateCaptureDate("2026-02-31"), false);
  assert.equal(validateCaptureDate("2026-13-01"), false);
  assert.equal(validateCaptureDate("28-07-2026"), false);
});

test("observerEnv forces UTF-8 for Python JSON output", () => {
  const env = observerEnv();

  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.PYTHONUTF8, "1");
});

test("observerPythonCommand uses the Nix dev shell when outside Nix", () => {
  const previous = process.env.IN_NIX_SHELL;
  const previousPython = process.env.ARCHERO_PYTHON;
  delete process.env.IN_NIX_SHELL;
  delete process.env.ARCHERO_PYTHON;
  try {
    const command = observerPythonCommand(["-B", "-m", "observer.import_capture", "2026-07-20"]);

    assert.equal(command.file, "nix");
    assert.deepEqual(command.args.slice(0, 3), ["develop", path.resolve(process.cwd(), ".."), "--command"]);
    assert.deepEqual(command.args.slice(3), ["python", "-B", "-m", "observer.import_capture", "2026-07-20"]);
  } finally {
    if (previous === undefined) {
      delete process.env.IN_NIX_SHELL;
    } else {
      process.env.IN_NIX_SHELL = previous;
    }
    if (previousPython === undefined) {
      delete process.env.ARCHERO_PYTHON;
    } else {
      process.env.ARCHERO_PYTHON = previousPython;
    }
  }
});

test("observerPythonCommand keeps direct python inside Nix", () => {
  const previous = process.env.IN_NIX_SHELL;
  process.env.IN_NIX_SHELL = "impure";
  try {
    const command = observerPythonCommand(["-B", "-m", "observer.capture", "guild-members"]);

    assert.equal(command.file, "python");
    assert.deepEqual(command.args, ["-B", "-m", "observer.capture", "guild-members"]);
  } finally {
    if (previous === undefined) {
      delete process.env.IN_NIX_SHELL;
    } else {
      process.env.IN_NIX_SHELL = previous;
    }
  }
});
