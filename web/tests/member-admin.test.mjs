import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { moveMemberAdminRecord, normalizeMemberAdminRecord, readMemberAdminRecords, saveMemberAdminRecord } from "../lib/member-admin.js";

test("normalizes private member administration data", () => {
  assert.deepEqual(
    normalizeMemberAdminRecord({
      absenceUntil: "2026-08-05",
      absenceReason: "Holiday",
      warnings: [{ reason: "Late notice", at: "2026-07-29" }],
      notes: ["Prefers Discord"],
    }),
    {
      absenceUntil: "2026-08-05",
      absenceReason: "Holiday",
      warnings: [{ reason: "Late notice", at: "2026-07-29" }],
      notes: [{ note: "Prefers Discord", at: new Date().toISOString().slice(0, 10) }],
    },
  );
});

test("clears the reason when an absence is removed", () => {
  assert.deepEqual(
    normalizeMemberAdminRecord({ absenceUntil: "", absenceReason: "Old reason", warnings: [], notes: [] }),
    { absenceUntil: null, absenceReason: "", warnings: [], notes: [] },
  );
});

test("rejects invalid dates and empty warnings", () => {
  assert.throws(() => normalizeMemberAdminRecord({ absenceUntil: "2026-02-30" }), /invalid/);
  assert.throws(() => normalizeMemberAdminRecord({ warnings: [""] }), /cannot be empty/);
});

test("persists private records by player ID", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "archero-member-admin-"));
  try {
    await saveMemberAdminRecord(root, "900000110", {
      absenceUntil: "2026-08-05",
      absenceReason: "Travel",
      warnings: ["Manual warning"],
      notes: ["Private note"],
    });
    const records = await readMemberAdminRecords(root);
    assert.equal(records["900000110"].absenceReason, "Travel");
    assert.equal(records["900000110"].warnings[0].reason, "Manual warning");
    assert.equal(records["900000110"].notes[0].note, "Private note");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("moves private records when a player ID changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "archero-member-admin-move-"));
  try {
    await saveMemberAdminRecord(root, "900000110", { warnings: ["Manual warning"] });
    await moveMemberAdminRecord(root, "900000110", "900000111");
    const records = await readMemberAdminRecords(root);
    assert.equal(records["900000110"], undefined);
    assert.equal(records["900000111"].warnings[0].reason, "Manual warning");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
