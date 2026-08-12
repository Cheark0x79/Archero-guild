import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  normalizeWarningAction,
  readWarningActions,
  saveWarningAction,
  warningActionKey,
} from "../lib/warning-actions.js";

test("warning officer follow-up is validated and persisted", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "archero-warning-actions-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const saved = await saveWarningAction(root, {
    playerId: "900000111",
    date: "2026-07-28",
    type: "missed_boss",
    status: "contacted",
    note: "Message sent on Discord.",
  });
  assert.equal(saved.status, "contacted");
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const actions = await readWarningActions(root);
  assert.equal(actions[warningActionKey("900000111", "2026-07-28", "missed_boss")].note, "Message sent on Discord.");
});

test("warning officer follow-up rejects unknown statuses and types", () => {
  assert.throws(
    () => normalizeWarningAction({ playerId: "123", date: "2026-07-28", type: "ocr", status: "noted" }),
    /warning type/,
  );
  assert.throws(
    () => normalizeWarningAction({ playerId: "123", date: "2026-07-28", type: "missed_boss", status: "archived" }),
    /warning status/,
  );
});

test("warning officer can ignore a warning", () => {
  const ignored = normalizeWarningAction({
    playerId: "123",
    date: "2026-07-28",
    type: "missed_boss",
    status: "ignored",
    note: "",
  });
  assert.equal(ignored.status, "ignored");
});
