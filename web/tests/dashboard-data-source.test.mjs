import test from "node:test";
import assert from "node:assert/strict";

import {
  dashboardPayloadFromDatabaseExport,
  invalidateDashboardDataCache,
  loadDashboardData,
  mergeWithLocalFallback,
  normalizeDatabasePayload,
  resetDashboardDataCacheForTest,
} from "../app/api/dashboard-data/source.js";

test("database payload never imports demo members or Discord links", () => {
  const merged = mergeWithLocalFallback(
    {
      guildRoster: [
        {
          playerId: "119974403",
          name: "Ac1s",
          discordName: null,
          discordLinked: false,
          status: "active",
        },
      ],
    },
    {
      captures: {},
      changes: [],
      dailyBossRawSnapshots: [],
      dailyRawSnapshots: [],
      guildRoster: [
        {
          playerId: "119974403",
          name: "Ac1s",
          discordLinked: true,
        },
        {
          playerId: null,
          name: "Former",
          status: "kicked",
        },
      ],
      memberSnapshots: [],
      previousMemberSnapshots: [],
      rules: {},
      ocrQueue: [],
    },
  );

  assert.deepEqual(merged.guildRoster, [
    {
      playerId: "119974403",
      name: "Ac1s",
      discordName: null,
      discordLinked: false,
      status: "active",
    },
  ]);
});

test("empty database collections stay empty instead of falling back to demo values", () => {
  const normalized = normalizeDatabasePayload({
    guildRoster: [],
    memberSnapshots: [],
    dailyRawSnapshots: [],
    dailyBossRawSnapshots: [],
    rules: {},
  });

  assert.deepEqual(normalized.guildRoster, []);
  assert.deepEqual(normalized.memberSnapshots, []);
  assert.deepEqual(normalized.dailyRawSnapshots, []);
  assert.deepEqual(normalized.dailyBossRawSnapshots, []);
  assert.deepEqual(normalized.rules, {});
  assert.equal(normalized.captures.lastCapturedAt, null);
});

test("an unavailable database produces an explicitly unavailable empty payload", () => {
  const payload = dashboardPayloadFromDatabaseExport({ ok: false, error: "connection refused" });

  assert.equal(payload.ok, false);
  assert.equal(payload.source, "database");
  assert.equal(payload.dataMode, "unavailable");
  assert.equal(payload.partial, true);
  assert.deepEqual(payload.data.guildRoster, []);
  assert.deepEqual(payload.data.memberSnapshots, []);
  assert.deepEqual(payload.data.rules, {});
});

test("a successful process with an invalid export is still treated as unavailable", () => {
  const payload = dashboardPayloadFromDatabaseExport({ ok: true, data: { output: "not-json" } });

  assert.equal(payload.dataMode, "unavailable");
  assert.equal(payload.partial, true);
  assert.deepEqual(payload.data.guildRoster, []);
  assert.match(payload.warning, /invalid payload/i);
});

test("a database payload with incomplete rules is marked partial without demo defaults", () => {
  const payload = dashboardPayloadFromDatabaseExport({
    ok: true,
    data: {
      captures: {},
      changes: [],
      dailyBossRawSnapshots: [],
      bossDefinitions: [],
      dailyRawSnapshots: [],
      guildRoster: [],
      memberSnapshots: [],
      previousMemberSnapshots: [],
      rules: { memberCapacity: 40 },
      ocrQueue: [],
    },
  });

  assert.equal(payload.dataMode, "live");
  assert.equal(payload.partial, true);
  assert.deepEqual(payload.missingDomains, ["rules"]);
  assert.deepEqual(payload.data.rules, { memberCapacity: 40 });
});

test("database exports are cached and concurrent requests share one process", async () => {
  resetDashboardDataCacheForTest();
  let calls = 0;
  const runExport = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      ok: true,
      data: {
        captures: {},
        changes: [],
        dailyBossRawSnapshots: [],
        bossDefinitions: [],
        dailyRawSnapshots: [],
        guildRoster: [],
        memberSnapshots: [],
        previousMemberSnapshots: [],
        rules: {
          maxInactiveDays: 3,
          minContribution7d: 500,
          minPowerGrowth14dPercent: 1,
          minBossTries: 2,
          newMemberGraceDays: 7,
          memberCapacity: 40,
        },
        ocrQueue: [],
      },
    };
  };
  const options = {
    environment: { ARCHERO_DATABASE_URL: "postgresql://test", ARCHERO_DATA_CACHE_TTL_MS: "60000" },
    runExport,
  };

  const [first, second] = await Promise.all([loadDashboardData(options), loadDashboardData(options)]);
  const third = await loadDashboardData(options);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(second, third);

  invalidateDashboardDataCache();
  await loadDashboardData(options);
  assert.equal(calls, 2);
  resetDashboardDataCacheForTest();
});
