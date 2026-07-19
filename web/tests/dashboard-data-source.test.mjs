import test from "node:test";
import assert from "node:assert/strict";

import { mergeWithLocalFallback } from "../app/api/dashboard-data/source.js";

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
