import test from "node:test";
import assert from "node:assert/strict";

import {
  databaseOnlyPayload,
  mergeDailySnapshots,
  mergeWithLocalFallback,
  requiresDatabase,
  selectWarningActions,
} from "../app/api/dashboard-data/source.js";

test("daily snapshots preserve older local history while DB overrides matching dates", () => {
  const merged = mergeDailySnapshots(
    [
      { date: "2026-07-27", rows: [{ playerId: "1", power: 300 }] },
    ],
    [
      { date: "2026-07-25", rows: [{ playerId: "1", power: 100 }] },
      { date: "2026-07-27", rows: [{ playerId: "1", power: 200 }] },
    ],
  );

  assert.deepEqual(merged, [
    { date: "2026-07-25", rows: [{ playerId: "1", power: 100 }] },
    { date: "2026-07-27", rows: [{ playerId: "1", power: 300 }] },
  ]);
});

test("dashboard DB payload keeps local Discord links when DB has not imported them yet", () => {
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
      discordName: undefined,
      discordLinked: true,
      status: "active",
    },
  ]);
});

test("production database mode never merges bundled demonstration history", () => {
  const result = databaseOnlyPayload(
    {
      dailyRawSnapshots: [{ date: "2026-07-28", rows: [] }],
      guildRoster: [],
      rules: { minBossTries: 3 },
    },
    {
      dailyRawSnapshots: [{ date: "2026-07-27", rows: [{ playerId: "demo" }] }],
      guildRoster: [{ playerId: "demo", name: "Demo" }],
      rules: { minBossTries: 2, maxInactiveDays: 3 },
      warningActions: {},
    },
  );

  assert.deepEqual(result.dailyRawSnapshots, [{ date: "2026-07-28", rows: [] }]);
  assert.deepEqual(result.guildRoster, []);
  assert.deepEqual(result.rules, { minBossTries: 3, maxInactiveDays: 3 });
  assert.equal(requiresDatabase({ ARCHERO_REQUIRE_DATABASE: "1" }), true);
});

test("officer warning actions are only included for administrators", () => {
  const actions = {
    "123:2026-07-29:missed_boss": {
      playerId: "123",
      date: "2026-07-29",
      type: "missed_boss",
      status: "contacted",
      note: "Private officer note",
    },
  };

  assert.deepEqual(selectWarningActions(actions, false), {});
  assert.deepEqual(selectWarningActions(actions, true), actions);
});
