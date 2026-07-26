import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dailyBossRawSnapshots, dailyRawSnapshots, guildRoster } from "../sample-data.js";

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  throw new Error("Usage: node scripts/export-day.mjs YYYY-MM-DD");
}

const members = dailyRawSnapshots.find((day) => day.date === date)?.rows ?? [];
const bossResults = dailyBossRawSnapshots.find((day) => day.date === date)?.rows ?? [];
if (!members.length && !bossResults.length) {
  throw new Error(`No data found for ${date}`);
}

const rosterById = new Map(guildRoster.filter((row) => row.playerId).map((row) => [row.playerId, row]));
const payload = {
  schemaVersion: 1,
  date,
  schemas: {
    member: {
      playerId: "string|null",
      name: "string|null",
      role: "string|null",
      power: "integer|null",
      contribution7d: "integer|null",
      bossAttacks: "integer|null",
      lastActivityDays: "integer|null",
      source: "string|null",
      lastSeenAt: "YYYY-MM-DD|null",
    },
    bossResult: {
      bossRank: "integer|null",
      playerId: "string|null",
      name: "string|null",
      rawName: "string|null",
      damageText: "string|null",
      bossDamageToday: "integer|null",
      area: "podium|list",
      source: "string",
      rowIndex: "integer",
      lastSeenAt: "YYYY-MM-DD|null",
    },
  },
  counts: { members: members.length, bossResults: bossResults.length },
  members: members.map((row) => ({
    playerId: row.playerId ?? null,
    name: rosterById.get(row.playerId)?.name ?? null,
    role: row.role ?? null,
    power: row.power ?? null,
    contribution7d: row.contribution7d ?? null,
    bossAttacks: row.bossAttacks ?? null,
    lastActivityDays: row.lastActivityDays ?? null,
    source: row.verificationNote?.replace(/^Screenshot check: |\.$/g, "") ?? null,
    lastSeenAt: row.lastSeenAt ?? date,
  })),
  bossResults: bossResults.map(({ rowLabel: _rowLabel, ...row }) => row),
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(scriptDir, "../../data/exports", `${date}.json`);
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(destination);
