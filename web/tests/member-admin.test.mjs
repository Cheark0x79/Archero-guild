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
      absenceFrom: "2026-08-05",
      absences: [], audit: [],
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
    { absenceFrom: null, absences: [], audit: [], absenceUntil: null, absenceReason: "", warnings: [], notes: [] },
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

test('absence changes preserve past approved dates and server-owned audit across replacement and removal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archero-absence-audit-'));
  try {
    const first = await saveMemberAdminRecord(root, '900000110', { absenceFrom: '2025-01-02', absenceUntil: '2025-01-05', absenceReason: 'Travel' });
    assert.equal(first.audit.length, 1);
    await assert.rejects(saveMemberAdminRecord(root, '900000110', undefined), /must be an object/);
    assert.equal((await readMemberAdminRecords(root))['900000110'].absenceFrom, '2025-01-02');
    const second = await saveMemberAdminRecord(root, '900000110', { absenceFrom: '2025-02-01', absenceUntil: '2025-02-02', audit: [], absences: [] });
    assert.deepEqual(second.absences, [{ from: '2025-01-02', until: '2025-01-05', note: 'Travel' }]);
    assert.equal(second.audit.length, 2);
    const removed = await saveMemberAdminRecord(root, '900000110', {});
    assert.equal(removed.absences.length, 2);
    assert.equal(removed.audit.length, 3);
    assert.equal(removed.audit[0].after.absenceReason, 'Travel');
    assert.equal((await readMemberAdminRecords(root))['900000110'].audit.length, 3);
    await assert.rejects(saveMemberAdminRecord(root, '900000110', { absenceFrom: '2025-03-02', absenceUntil: '2025-03-01' }), /start/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('concurrent acknowledged saves retain every approved date and audit, including other players', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archero-concurrent-absence-'));
  const period = day => ({absenceFrom:`2025-01-0${day}`,absenceUntil:`2025-01-0${day}`});
  try {
    await saveMemberAdminRecord(root,'900000110',period(1));
    await Promise.all([saveMemberAdminRecord(root,'900000110',period(2)),saveMemberAdminRecord(root,'900000110',period(3)),saveMemberAdminRecord(root,'900000111',period(4))]);
    const records=await readMemberAdminRecords(root);
    const record=records['900000110'];
    assert.equal(record.audit.length,3);
    assert.deepEqual(record.audit.map(event=>event.after.absenceFrom).sort(),['2025-01-01','2025-01-02','2025-01-03']);
    assert.deepEqual([...record.absences.map(period=>period.from),record.absenceFrom].sort(),['2025-01-01','2025-01-02','2025-01-03']);
    assert.equal(records['900000111'].absenceFrom,'2025-01-04');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('separate Node writers share the same records lock and moves preserve unrelated saves', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archero-process-absence-'));
  const moduleUrl=new URL('../lib/member-admin.js',import.meta.url).href;
  const source=`import {saveMemberAdminRecord} from ${JSON.stringify(moduleUrl)}; await saveMemberAdminRecord(process.argv[1], '900000110', {absenceFrom:process.argv[2],absenceUntil:process.argv[2]});`;
  try {
    await saveMemberAdminRecord(root,'900000110',{absenceFrom:'2025-01-01',absenceUntil:'2025-01-01'});
    await Promise.all(['2025-01-02','2025-01-03'].map(date=>run(process.execPath,['--input-type=module','-e',source,root,date])));
    assert.equal((await readMemberAdminRecords(root))['900000110'].audit.length,3);
    await Promise.all([moveMemberAdminRecord(root,'900000110','900000112'),saveMemberAdminRecord(root,'900000111',{absenceFrom:'2025-01-04',absenceUntil:'2025-01-04'})]);
    const records=await readMemberAdminRecords(root);
    assert.equal(records['900000110'],undefined);
    assert.equal(records['900000112'].audit.length,3);
    assert.equal(records['900000111'].absenceFrom,'2025-01-04');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
