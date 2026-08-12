import assert from "node:assert/strict";
import test from "node:test";

import { createDemoData, DEMO_PRIMARY_PLAYER_ID, DEMO_SCENARIOS } from "../lib/demo-data.js";
import { auditBossHistory } from "../lib/boss-history-audit.js";

test("synthetic demo data is deterministic and contains no legacy guild identities", () => {
  const options = { seed: "stable-test", anchorDate: "2026-08-09", scenario: "baseline" };
  const first = createDemoData(options);
  const second = createDemoData(options);

  assert.deepEqual(first, second);
  assert.equal(first.guildRoster.length, 40);
  assert.equal(first.dailyRawSnapshots.length, 21);
  assert.equal(first.dailyBossRawSnapshots.length, 21);
  assert.equal(first.dailyBossRawSnapshots.at(-1).date, "2026-08-09");
  assert.equal(first.guildRoster.every((member) => /^9000000\d{2}$/.test(member.playerId)), true);
  assert.equal(first.guildRoster.every((member) => member.name.startsWith("Demo")), true);
  assert.equal(JSON.stringify(first).includes("900000104"), false);
  assert.equal(JSON.stringify(first).includes("MapleFox"), false);
});

test("baseline covers every boss and gives the primary fixture member a result for each", () => {
  const data = createDemoData({ anchorDate: "2026-08-09" });
  const bosses = new Set(data.dailyBossRawSnapshots.map((snapshot) => snapshot.bossKey));
  const primaryBosses = new Set(
    data.dailyBossRawSnapshots
      .filter((snapshot) => snapshot.rows.some((row) => row.playerId === DEMO_PRIMARY_PLAYER_ID))
      .map((snapshot) => snapshot.bossKey),
  );

  assert.equal(bosses.size, 7);
  assert.equal(primaryBosses.size, 7);
  assert.equal(auditBossHistory(data).summary.mismatchedDays, 0);
});

test("named scenarios provide controlled anomalies without changing the contract", () => {
  assert.deepEqual(DEMO_SCENARIOS, ["baseline", "audit-anomalies", "record-variants", "sparse"]);
  const anomalous = createDemoData({ scenario: "audit-anomalies" });
  const sparse = createDemoData({ scenario: "sparse" });

  assert.ok(auditBossHistory(anomalous).summary.mismatchedDays >= 1);
  assert.ok(auditBossHistory(anomalous).issues.some((issue) => issue.type === "missing_explicit_boss"));
  assert.ok(sparse.memberSnapshots.some((member) => member.metricsVerified === false));
  assert.throws(() => createDemoData({ scenario: "production" }), /Unknown demo scenario/);
  assert.throws(() => createDemoData({ anchorDate: "2026-02-31" }), /real YYYY-MM-DD/);
});
