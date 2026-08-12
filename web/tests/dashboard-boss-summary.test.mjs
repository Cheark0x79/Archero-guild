import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardBossSummary } from "../lib/dashboard-boss-summary.js";

const bosses = [
  { key: "sunday", weekday: 0, name: "Sunday boss" },
  { key: "monday", weekday: 1, name: "Monday boss" },
];

test("dashboard boss summary shows today's rotation and yesterday's participation", () => {
  const summary = buildDashboardBossSummary({
    today: "2026-08-10",
    definitions: bosses,
    memberCount: 41,
    snapshots: [{
      date: "2026-08-09",
      bossKey: "sunday",
      rows: [
        { playerId: "1", bossDamageToday: 100 },
        { playerId: "2", bossAttacks: 1, bossDamageToday: 0 },
        { playerId: "3", bossAttacks: 0, bossDamageToday: 0 },
        { playerId: "former", bossDamageToday: 100 },
      ],
    }],
    includePlayer: (playerId) => playerId !== "former",
  });

  assert.equal(summary.todayBoss.key, "monday");
  assert.equal(summary.resultBoss.key, "sunday");
  assert.equal(summary.resultDate, "2026-08-09");
  assert.equal(summary.participants, 2);
  assert.equal(summary.memberCount, 41);
  assert.equal(summary.resultCaptured, true);
  assert.equal(summary.resultIsYesterday, true);
});

test("dashboard boss summary falls back to the latest captured result and its roster participation", () => {
  const summary = buildDashboardBossSummary({
    today: "2026-08-10",
    definitions: bosses,
    memberCount: 41,
    snapshots: [{ date: "2026-08-08", bossKey: "sunday", rows: [{ playerId: "1", bossDamageToday: 100 }] }],
    participationSnapshots: [{
      date: "2026-08-08",
      rows: [{ playerId: "1", bossAttacks: 1 }, { playerId: "2", bossAttacks: 1 }],
    }],
  });

  assert.equal(summary.todayBoss.key, "monday");
  assert.equal(summary.resultBoss.key, "sunday");
  assert.equal(summary.resultDate, "2026-08-08");
  assert.equal(summary.participants, 2);
  assert.equal(summary.resultCaptured, true);
  assert.equal(summary.resultIsYesterday, false);
});
