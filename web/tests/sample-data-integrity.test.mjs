import test from "node:test";
import assert from "node:assert/strict";

import { dailyBossRawSnapshots, dailyRawSnapshots, guildRoster, memberSnapshots } from "../sample-data.js";

test("guild roster does not contain duplicate active player ids", () => {
  const ids = guildRoster.filter((member) => member.playerId && !["kicked", "left", "inactive"].includes(member.status)).map((member) => member.playerId);
  assert.deepEqual(duplicates(ids), []);
});

test("latest member snapshots match the latest raw guild import rows", () => {
  const latest = dailyRawSnapshots.at(-1);
  const rawById = new Map(latest.rows.filter((row) => row.playerId).map((row) => [row.playerId, row]));
  const mismatches = [];

  for (const member of memberSnapshots.filter((row) => row.playerId && row.lastSeenAt === latest.date)) {
    const raw = rawById.get(member.playerId);
    if (!raw) {
      mismatches.push(`${member.playerId}: missing raw row`);
      continue;
    }
    for (const key of ["power", "contribution7d", "bossAttacks"]) {
      if (member[key] !== raw[key]) mismatches.push(`${member.playerId}: ${key} ${member[key]} != ${raw[key]}`);
    }
  }

  assert.equal(memberSnapshots.filter((row) => row.lastSeenAt === latest.date).length, latest.rows.length);
  assert.deepEqual(mismatches, []);
});

test("boss raw snapshots keep one row per ranked boss day", () => {
  const conflicts = [];
  for (const day of dailyBossRawSnapshots) {
    const seen = new Set();
    for (const row of day.rows) {
      if (row.bossRank == null) continue;
      const key = `${day.date}:${row.bossRank}`;
      if (seen.has(key)) conflicts.push(key);
      seen.add(key);
    }
  }

  assert.deepEqual(conflicts, []);
});

test("boss ranked rows do not increase damage below a higher rank", () => {
  const inversions = [];
  for (const day of dailyBossRawSnapshots) {
    const rankedRows = (day.rows ?? [])
      .filter((row) => row.bossRank != null && typeof row.bossDamageToday === "number")
      .sort((left, right) => left.bossRank - right.bossRank);
    let previous = null;
    for (const row of rankedRows) {
      if (previous && row.bossDamageToday > previous.bossDamageToday) {
        inversions.push(`${day.date}: rank ${row.bossRank} ${row.name} ${row.damageText} > rank ${previous.bossRank} ${previous.name} ${previous.damageText}`);
      }
      previous = row;
    }
  }

  assert.deepEqual(inversions, []);
});

test("weekly donation resets do not create negative latest deltas", () => {
  const negativeResetDeltas = [];
  for (const member of memberSnapshots) {
    const previous = member.previousSnapshot;
    if (!previous?.lastSeenAt || !member.lastSeenAt) continue;
    const changedWeek = weekStartDate(member.lastSeenAt) !== weekStartDate(previous.lastSeenAt);
    const resetLower = typeof member.contribution7d === "number" && typeof previous.contribution7d === "number" && member.contribution7d < previous.contribution7d;
    if (changedWeek && resetLower && typeof member.contributionDelta === "number" && member.contributionDelta < 0) {
      negativeResetDeltas.push(`${member.playerId}: ${member.contributionDelta}`);
    }
  }

  assert.deepEqual(negativeResetDeltas, []);
});

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function weekStartDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - weekday + 1);
  return current.toISOString().slice(0, 10);
}
