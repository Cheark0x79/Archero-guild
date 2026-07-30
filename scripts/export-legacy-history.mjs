import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PRESERVED_DATES = [
  "2026-07-14",
  "2026-07-15",
  "2026-07-16",
  "2026-07-17",
  "2026-07-18",
  "2026-07-19",
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-25",
];

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

const sourcePath = argument("--source");
const outputPath = argument("--output");
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const source = await import(`${pathToFileURL(sourcePath).href}?sha256=${sourceSha256}`);
const allowed = new Set(PRESERVED_DATES);

const dailyRawSnapshots = (source.dailyRawSnapshots ?? []).filter((day) => allowed.has(day.date));
const dailyBossRawSnapshots = (source.dailyBossRawSnapshots ?? []).filter((day) => allowed.has(day.date));
const payload = {
  schemaVersion: 1,
  kind: "archero-legacy-history",
  sourceSha256,
  preservedDates: PRESERVED_DATES,
  guildRoster: source.guildRoster ?? [],
  dailyRawSnapshots,
  dailyBossRawSnapshots,
};

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

console.log(JSON.stringify({
  output: outputPath,
  sourceSha256,
  rosterRows: payload.guildRoster.length,
  memberDays: dailyRawSnapshots.length,
  memberRows: dailyRawSnapshots.reduce((total, day) => total + day.rows.length, 0),
  bossDays: dailyBossRawSnapshots.length,
  bossRows: dailyBossRawSnapshots.reduce((total, day) => total + day.rows.length, 0),
}, null, 2));
