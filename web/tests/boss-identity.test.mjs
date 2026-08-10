import assert from "node:assert/strict";
import test from "node:test";

import { bossDefinitionForSnapshot } from "../lib/boss-identity.js";
import { sharedMemberProfileFromData } from "../lib/shared-member.js";

process.env.ARCHERO_SHARE_LINK_SECRET ??= "test-only-share-link-secret-32-bytes";

const definitions = [
  { key: "medusa", weekday: 4, name: "Medusa", imagePath: "/bosses/medusa.png" },
  { key: "stoneman", weekday: 5, name: "Stoneman", imagePath: "/bosses/stoneman.png" },
];

test("an exported boss identity wins over weekday inference", () => {
  const snapshot = { date: "2026-08-07", bossKey: "medusa", boss: { key: "medusa", name: "Medusa" } };

  assert.equal(bossDefinitionForSnapshot(snapshot, definitions).key, "medusa");
});

test("a shared personal best keeps the exported boss, record date, and damage aligned", () => {
  const data = {
    rules: {},
    bossDefinitions: definitions,
    guildRoster: [{ playerId: "123", name: "Alice", role: "member", status: "active" }],
    memberSnapshots: [{
      playerId: "123",
      name: "Alice",
      role: "member",
      power: 1_000,
      contribution7d: 0,
      bossAttacks: 1,
      lastActivityDays: 0,
      lastSeenAt: "2026-08-07",
      metricsCaptured: true,
      metricsVerified: true,
    }],
    dailyRawSnapshots: [{ date: "2026-08-07", rows: [{ playerId: "123", power: 1_000 }] }],
    dailyBossRawSnapshots: [{
      date: "2026-08-07",
      bossKey: "medusa",
      boss: { key: "medusa", name: "Medusa", weekday: 4 },
      rows: [{ playerId: "123", name: "Alice", bossDamageToday: 31_000_000_000, bossRank: 1 }],
    }],
  };

  const profile = sharedMemberProfileFromData(data, "123");
  const medusa = profile.personalBests.find((record) => record.boss.key === "medusa");
  const stoneman = profile.personalBests.find((record) => record.boss.key === "stoneman");

  assert.equal(medusa.bestDamage, 31_000_000_000);
  assert.equal(medusa.bestDate, "2026-08-07");
  assert.equal(stoneman.bestDamage, null);
  assert.equal(profile.recentBossResults[0].boss.key, "medusa");
});
