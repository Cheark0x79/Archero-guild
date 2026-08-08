import assert from "node:assert/strict";
import test from "node:test";

import { validateImportBatch } from "../lib/import-batch.js";

function validBatch() {
  return {
    schemaVersion: 1,
    captureDate: "2026-07-29",
    generatedAt: "2026-07-29T20:15:00Z",
    agentVersion: "test-sha",
    idempotencyKey: "2026-07-29:0123456789abcdef",
    sourceImages: [{
      kind: "guild-members",
      sha256: "a".repeat(64),
      width: 1440,
      height: 2560,
      detectedRows: 1,
    }],
    members: [{
      playerId: "123",
      name: "Alice",
      role: "member",
      power: 1000000,
      contribution7d: 500,
      bossAttacks: 2,
      lastActivityDays: 0,
      source: "members-001.png row 0",
    }],
    bossRankings: [],
    quality: { status: "pass", coverage: 1, completeness: 1, warnings: [] },
  };
}

test("accepts a complete publishable OCR batch", () => {
  const result = validateImportBatch(validBatch(), { requirePublishable: true });
  assert.equal(result.valid, true);
  assert.equal(result.publishable, true);
});

test("accepts members and boss as one atomic publishable batch", () => {
  const batch = validBatch();
  batch.sourceImages.push({
    kind: "guild-boss",
    sha256: "b".repeat(64),
    width: 1440,
    height: 2560,
    detectedRows: 1,
  });
  batch.bossRankings.push({
    rank: 1,
    name: "Alice",
    damageText: "2.5M",
    damage: 2_500_000,
    source: "boss.png podium 1",
  });

  const result = validateImportBatch(batch, { requirePublishable: true });

  assert.equal(result.valid, true);
  assert.equal(result.publishable, true);
});

test("rejects duplicate identities and invalid quality", () => {
  const batch = validBatch();
  batch.members.push({ ...batch.members[0] });
  batch.quality = { status: "review", coverage: 0.8, completeness: 1, warnings: ["review"] };
  const result = validateImportBatch(batch, { requirePublishable: true });
  assert.equal(result.valid, false);
  assert.equal(result.publishable, false);
  assert.match(result.errors.join(" "), /duplicate playerId/);
  assert.match(result.errors.join(" "), /quality gate/);
});

test("rejects a claimed pass when detected screenshots have no extracted rows", () => {
  const batch = validBatch();
  batch.members = [];

  const result = validateImportBatch(batch, { requirePublishable: true });

  assert.equal(result.valid, false);
  assert.equal(result.publishable, false);
  assert.match(result.errors.join(" "), /members is empty/);
});

test("accepts missing member metrics while keeping the row reviewable", () => {
  const batch = validBatch();
  batch.members[0].contribution7d = null;
  batch.quality = { status: "review", coverage: 1, completeness: 0, warnings: ["missing donation"] };

  const result = validateImportBatch(batch, { requirePublishable: true });

  assert.equal(result.valid, true);
  assert.equal(result.publishable, true);
});

test("accepts optional guild statistics and rejects impossible capacity", () => {
  const batch = validBatch();
  batch.guildStats = {
    guildName: "Les Archers",
    guildId: "FR-2048",
    level: 12,
    memberCount: 38,
    memberCapacity: 40,
    totalPower: 52_400_000,
    donationsValue: null,
    rank: 73,
    xpCurrent: 1_200_000,
    xpRequired: 2_000_000,
  };
  assert.equal(validateImportBatch(batch, { requirePublishable: true }).valid, true);

  batch.guildStats.memberCount = 41;
  const invalid = validateImportBatch(batch, { requirePublishable: true });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /cannot exceed memberCapacity/);
});
