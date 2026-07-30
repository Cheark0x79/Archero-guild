import fs from "node:fs/promises";
import path from "node:path";

import {
  dailyBossRawSnapshots,
  dailyRawSnapshots,
  guildRoster,
  memberSnapshots,
  previousMemberSnapshots,
} from "../sample-data.js";

const staticRoot = path.resolve(".next", "static");
const sensitiveValues = new Set();

collectSensitiveValues(
  {
    dailyBossRawSnapshots,
    dailyRawSnapshots,
    guildRoster,
    memberSnapshots,
    previousMemberSnapshots,
  },
  sensitiveValues,
);

const files = await listFiles(staticRoot);
const exposedFiles = [];
for (const file of files) {
  const contents = await fs.readFile(file, "utf8");
  if ([...sensitiveValues].some((value) => contents.includes(value))) {
    exposedFiles.push(path.relative(process.cwd(), file));
  }
}

if (exposedFiles.length > 0) {
  console.error(`Public bundle contains guild data in ${exposedFiles.length} file(s):`);
  for (const file of exposedFiles) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log(`Public bundle privacy check passed (${files.length} static files scanned).`);
}

function collectSensitiveValues(value, destination, key = "") {
  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveValues(item, destination, key);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [childKey, childValue] of Object.entries(value)) {
    if (Array.isArray(childValue)) {
      collectSensitiveValues(childValue, destination, childKey);
      continue;
    }
    if (childValue && typeof childValue === "object") {
      collectSensitiveValues(childValue, destination, childKey);
      continue;
    }
    if (
      typeof childValue === "string"
      && ["playerId", "name", "rawName", "detectedName", "discordName"].includes(childKey)
      && childValue.trim().length >= 4
    ) {
      destination.add(childValue.trim());
    }
  }
}

async function listFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}
