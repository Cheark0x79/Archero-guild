import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { MAX_UPLOAD_BYTES, findExistingScreenshotByHash, observerPythonCommand, readUploadedPng } from "../app/api/data/actions.js";

const PNG_BYTES = await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).png().toBuffer();

test("readUploadedPng validates PNG files and returns a sha256 digest", async () => {
  const file = new File([PNG_BYTES], "members.png", { type: "image/png" });

  const upload = await readUploadedPng(file);

  assert.equal(upload.size, PNG_BYTES.length);
  assert.equal(upload.width, 1);
  assert.equal(upload.height, 1);
  assert.match(upload.sha256, /^[a-f0-9]{64}$/);
});

test("readUploadedPng rejects a signature-only fake PNG", async () => {
  const fake = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "fake.png", { type: "image/png" });
  await assert.rejects(() => readUploadedPng(fake), /invalid|valid PNG/);
});

test("readUploadedPng rejects oversized screenshots before writing", async () => {
  const file = new File([PNG_BYTES, new Uint8Array(MAX_UPLOAD_BYTES)], "large.png", { type: "image/png" });

  await assert.rejects(() => readUploadedPng(file), /too large/);
});

test("findExistingScreenshotByHash finds an exact upload duplicate for the same kind and date", async () => {
  const previousCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "archero-upload-test-"));
  process.chdir(root);
  try {
    const screenshotDir = path.join(root, "screenshots", "raw", "2026-07-20", "guild");
    await fs.mkdir(screenshotDir, { recursive: true });
    await fs.writeFile(path.join(screenshotDir, "members-001.png"), PNG_BYTES);
    const file = new File([PNG_BYTES], "members.png", { type: "image/png" });
    const upload = await readUploadedPng(file);

    const duplicate = await findExistingScreenshotByHash("guild-members", "2026-07-20", upload.sha256);

    assert.equal(duplicate?.index, 1);
    assert.equal(duplicate?.date, "2026-07-20");
    assert.equal(path.basename(duplicate?.absolutePath ?? ""), "members-001.png");
  } finally {
    process.chdir(previousCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("observerPythonCommand uses the Nix dev shell when outside Nix", () => {
  const previous = process.env.IN_NIX_SHELL;
  delete process.env.IN_NIX_SHELL;
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
