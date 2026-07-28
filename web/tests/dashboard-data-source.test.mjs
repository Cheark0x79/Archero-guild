import test from "node:test";
import assert from "node:assert/strict";

import { mergeDailySnapshots, mergeWithLocalFallback } from "../app/api/dashboard-data/source.js";

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
