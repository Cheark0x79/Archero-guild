import crypto from "node:crypto";

import { createDemoData } from "./demo-data.js";
import { validateImportBatch } from "./import-batch.js";

const SYNTHETIC_ID_PREFIX = "9000000";
const SYNTHETIC_NAME_PREFIX = "Demo";

export function syntheticTestDataAllowed(environment = process.env) {
  if (!["development", "test"].includes(environment.ARCHERO_DEPLOYMENT_ENV)) return false;
  if (environment.ARCHERO_ENABLE_TEST_DATA_ADMIN !== "1") return false;
  if (environment.ARCHERO_REQUIRE_DATABASE === "1") return false;
  if (!/^t-[a-z0-9-]+$/.test(environment.ARCHERO_ENVIRONMENT_ID ?? "")) return false;
  if (!environment.ARCHERO_DATABASE_URL && !environment.DATABASE_URL) return false;
  try {
    const origin = new URL(environment.ARCHERO_PUBLIC_ORIGIN ?? "");
    return origin.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(origin.hostname);
  } catch {
    return false;
  }
}

export function databaseContainsOnlySyntheticMembers(roster = []) {
  return roster.every((member) => (
    String(member?.playerId ?? "").startsWith(SYNTHETIC_ID_PREFIX)
    && String(member?.name ?? "").startsWith(SYNTHETIC_NAME_PREFIX)
  ));
}

export function createSyntheticImportBatches(options = {}) {
  const scenario = options.scenario ?? "baseline";
  const data = createDemoData({
    seed: options.seed ?? "archero-web-demo-v1",
    anchorDate: options.anchorDate ?? "2026-08-09",
    scenario,
  });
  const bossesByDate = new Map(data.dailyBossRawSnapshots.map((snapshot) => [snapshot.date, snapshot]));

  return data.dailyRawSnapshots.map((snapshot) => {
    const bossSnapshot = bossesByDate.get(snapshot.date);
    const dateKey = snapshot.date.replaceAll("-", "");
    const members = snapshot.rows.map((row, index) => ({
      playerId: row.playerId ?? null,
      name: row.name,
      rawName: row.name,
      role: row.role ?? null,
      power: row.power ?? null,
      powerText: formatCompactNumber(row.power),
      contribution7d: row.contribution7d ?? null,
      bossAttacks: row.bossAttacks ?? null,
      lastActivityDays: row.lastActivityDays ?? null,
      activityText: row.lastActivityDays === 0 ? "Online" : `${row.lastActivityDays}d`,
      source: `synthetic/members-${snapshot.date}.png row ${index}`,
      matchScore: row.playerId ? 1 : 0,
    }));
    const bossRankings = (bossSnapshot?.rows ?? []).map((row, index) => ({
      playerId: row.playerId ?? null,
      name: row.name,
      rawName: row.rawName ?? row.name,
      rank: row.bossRank,
      damageText: row.damageText,
      damage: row.bossDamageToday,
      area: row.area ?? (row.bossRank <= 3 ? "podium" : "list"),
      rowIndex: row.rowIndex ?? index,
      source: row.source,
    }));
    const batch = {
      schemaVersion: 1,
      captureDate: snapshot.date,
      generatedAt: `${snapshot.date}T20:30:00+02:00`,
      agentVersion: `synthetic-web-admin-v1-${scenario}`,
      idempotencyKey: `synthetic-web-admin-v1:${scenario}:${snapshot.date}`,
      sourceImages: [
        syntheticImage("guild-members", dateKey, members.length),
        syntheticImage("guild-boss", dateKey, bossRankings.length),
      ],
      members,
      bossRankings,
      quality: {
        status: members.every((member) => member.playerId) ? "pass" : "review",
        coverage: 1,
        completeness: members.filter((member) => member.playerId).length / members.length,
        warnings: members.some((member) => !member.playerId) ? ["Synthetic unresolved member row"] : [],
      },
    };
    const validation = validateImportBatch(batch, { requirePublishable: true });
    if (!validation.valid) throw new Error(`Invalid synthetic batch for ${snapshot.date}: ${validation.errors.join("; ")}`);
    return batch;
  });
}

function syntheticImage(kind, dateKey, detectedRows) {
  const sourceName = `synthetic-${kind}-${dateKey}.png`;
  return {
    kind,
    sha256: crypto.createHash("sha256").update(sourceName).digest("hex"),
    width: 1440,
    height: 2560,
    detectedRows,
    sourceName,
  };
}

function formatCompactNumber(value) {
  if (typeof value !== "number") return null;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return String(value);
}
