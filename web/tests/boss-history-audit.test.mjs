import assert from "node:assert/strict";
import test from "node:test";

import { auditBossHistory } from "../lib/boss-history-audit.js";

const bossDefinitions = [
  { key: "treant-guardian", weekday: 1, dayLabel: "Mon", name: "Treant Guardian" },
  { key: "fire-dragon", weekday: 2, dayLabel: "Tue", name: "Fire Dragon" },
  { key: "flame-demon", weekday: 3, dayLabel: "Wed", name: "Flame Demon" },
  { key: "medusa", weekday: 4, dayLabel: "Thu", name: "Medusa" },
  { key: "stoneman", weekday: 5, dayLabel: "Fri", name: "Stoneman" },
  { key: "cyclops-mage", weekday: 6, dayLabel: "Sat", name: "Cyclops Mage" },
  { key: "grim-reaper", weekday: 0, dayLabel: "Sun", name: "Grim Reaper" },
];

test("reports the canonical Monday-to-Sunday boss rotation", () => {
  const audit = auditBossHistory({ dailyBossRawSnapshots: [] });

  assert.deepEqual(audit.rotation.map((boss) => boss.key), [
    "treant-guardian",
    "fire-dragon",
    "flame-demon",
    "medusa",
    "stoneman",
    "cyclops-mage",
    "grim-reaper",
  ]);
});

test("detects a Friday export carrying Thursday Medusa records and proposes Thursday", () => {
  const audit = auditBossHistory({
    bossDefinitions,
    dailyBossRawSnapshots: [{
      date: "2026-08-07",
      bossKey: "medusa",
      boss: { key: "medusa", name: "Medusa", weekday: 4 },
      rows: [{ playerId: "123", name: "Alice", bossDamageToday: 31_000_000_000 }],
    }],
  });

  assert.equal(audit.summary.mismatchedDays, 1);
  assert.equal(audit.summary.personalBestsAffected, 1);
  assert.deepEqual(audit.issues[0], {
    type: "weekday_mismatch",
    date: "2026-08-07",
    actualBoss: { key: "medusa", name: "Medusa", weekday: 4 },
    expectedBoss: { key: "stoneman", name: "Stoneman", weekday: 5 },
    rowsAffected: 1,
    personalBestsAffected: 1,
    suggestedPreviousDate: "2026-08-06",
  });
});

test("accepts Medusa on Thursday and flags legacy snapshots without an explicit boss", () => {
  const audit = auditBossHistory({
    bossDefinitions,
    dailyBossRawSnapshots: [
      { date: "2026-08-06", bossKey: "medusa", rows: [] },
      { date: "2026-08-07", rows: [] },
    ],
  });

  assert.equal(audit.summary.mismatchedDays, 0);
  assert.deepEqual(audit.issues.map((issue) => issue.type), ["missing_explicit_boss"]);
});
