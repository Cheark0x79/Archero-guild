import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  observerEnv,
  observerPythonCommand,
} from "../app/api/data/actions.js";

test("observerEnv forces UTF-8 for Python JSON output", () => {
  const env = observerEnv();

  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.PYTHONUTF8, "1");
  assert.equal(env.PYTHONPATH.split(path.delimiter)[0], path.join(path.resolve(process.cwd(), ".."), "ocr", "app"));
});

test("observerPythonCommand uses direct Python when no runtime is configured", () => {
  const previousPython = process.env.ARCHERO_PYTHON;
  delete process.env.ARCHERO_PYTHON;
  try {
    const command = observerPythonCommand(["-B", "-m", "archero_guild.import_capture", "2026-07-20"]);

    assert.equal(command.file, "python");
    assert.deepEqual(command.args, ["-B", "-m", "archero_guild.import_capture", "2026-07-20"]);
  } finally {
    if (previousPython === undefined) {
      delete process.env.ARCHERO_PYTHON;
    } else {
      process.env.ARCHERO_PYTHON = previousPython;
    }
  }
});

test("observerPythonCommand prefers the configured Python runtime", () => {
  const previousPython = process.env.ARCHERO_PYTHON;
  process.env.ARCHERO_PYTHON = "/opt/archero-venv/bin/python";
  try {
    const command = observerPythonCommand(["-B", "-m", "archero_guild.import_capture", "2026-07-20"]);

    assert.equal(command.file, "/opt/archero-venv/bin/python");
    assert.deepEqual(command.args, ["-B", "-m", "archero_guild.import_capture", "2026-07-20"]);
  } finally {
    if (previousPython === undefined) {
      delete process.env.ARCHERO_PYTHON;
    } else {
      process.env.ARCHERO_PYTHON = previousPython;
    }
  }
});
