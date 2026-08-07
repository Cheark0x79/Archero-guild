import { bossDefinitionForDate, bossDefinitionForSnapshot } from "./boss-identity.js";

const CANONICAL_BOSS_ROTATION = [
  { key: "treant-guardian", weekday: 1, dayLabel: "Mon", name: "Treant Guardian" },
  { key: "fire-dragon", weekday: 2, dayLabel: "Tue", name: "Fire Dragon" },
  { key: "flame-demon", weekday: 3, dayLabel: "Wed", name: "Flame Demon" },
  { key: "medusa", weekday: 4, dayLabel: "Thu", name: "Medusa" },
  { key: "stoneman", weekday: 5, dayLabel: "Fri", name: "Stoneman" },
  { key: "cyclops-mage", weekday: 6, dayLabel: "Sat", name: "Cyclops Mage" },
  { key: "grim-reaper", weekday: 0, dayLabel: "Sun", name: "Grim Reaper" },
];

export function auditBossHistory(data) {
  const definitions = Array.isArray(data?.bossDefinitions) && data.bossDefinitions.length > 0
    ? data.bossDefinitions
    : CANONICAL_BOSS_ROTATION;
  const snapshots = Array.isArray(data?.dailyBossRawSnapshots) ? data.dailyBossRawSnapshots : [];
  const personalBests = personalBestRows(snapshots, definitions);
  const issues = [];
  const bossesByDate = new Map();

  for (const snapshot of snapshots) {
    const date = validIsoDate(snapshot?.date) ? snapshot.date : null;
    const explicitKey = snapshot?.boss?.key ?? snapshot?.bossKey ?? null;
    const actual = bossDefinitionForSnapshot(snapshot, definitions);
    const expected = date ? bossDefinitionForDate(date, definitions) : null;
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];

    if (!date) {
      issues.push(issue("invalid_date", snapshot?.date ?? null, actual, expected, rows, 0));
      continue;
    }
    const dateBosses = bossesByDate.get(date) ?? new Set();
    if (actual?.key) dateBosses.add(actual.key);
    bossesByDate.set(date, dateBosses);

    const bestsAffected = rows.filter((row) => personalBests.has(personalBestKey(row, actual?.key, date))).length;
    if (!explicitKey) {
      issues.push(issue("missing_explicit_boss", date, actual, expected, rows, bestsAffected));
      continue;
    }
    if (!definitions.some((boss) => boss.key === explicitKey)) {
      issues.push(issue("unknown_boss", date, actual, expected, rows, bestsAffected));
      continue;
    }
    if (expected?.key && explicitKey !== expected.key) {
      issues.push({
        ...issue("weekday_mismatch", date, actual, expected, rows, bestsAffected),
        suggestedPreviousDate: previousDateForWeekday(date, actual?.weekday),
      });
    }
  }

  for (const [date, bossKeys] of bossesByDate) {
    if (bossKeys.size > 1) {
      issues.push({
        type: "multiple_bosses_for_date",
        date,
        bossKeys: [...bossKeys].sort(),
        rowsAffected: snapshots
          .filter((snapshot) => snapshot.date === date)
          .reduce((total, snapshot) => total + (snapshot.rows?.length ?? 0), 0),
        personalBestsAffected: 0,
      });
    }
  }

  return {
    rotation: definitions
      .map((boss) => ({ key: boss.key, name: boss.name, weekday: boss.weekday, dayLabel: boss.dayLabel ?? weekdayLabel(boss.weekday) }))
      .sort((left, right) => mondayFirst(left.weekday) - mondayFirst(right.weekday)),
    summary: {
      daysChecked: new Set(snapshots.map((snapshot) => snapshot?.date).filter(validIsoDate)).size,
      snapshotsChecked: snapshots.length,
      rowsChecked: snapshots.reduce((total, snapshot) => total + (snapshot?.rows?.length ?? 0), 0),
      issues: issues.length,
      mismatchedDays: new Set(issues.filter((item) => item.type === "weekday_mismatch").map((item) => item.date)).size,
      personalBestsAffected: issues.reduce((total, item) => total + (item.personalBestsAffected ?? 0), 0),
    },
    issues: issues.sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")) || left.type.localeCompare(right.type)),
  };
}

function personalBestRows(snapshots, definitions) {
  const bestByBossAndPlayer = new Map();
  for (const snapshot of snapshots) {
    const boss = bossDefinitionForSnapshot(snapshot, definitions);
    for (const row of snapshot?.rows ?? []) {
      if (typeof row?.bossDamageToday !== "number") continue;
      const identity = row.playerId ?? row.name;
      if (!identity || !boss?.key) continue;
      const key = `${boss.key}:${identity}`;
      const previous = bestByBossAndPlayer.get(key);
      if (!previous || row.bossDamageToday > previous.damage || (row.bossDamageToday === previous.damage && snapshot.date > previous.date)) {
        bestByBossAndPlayer.set(key, { damage: row.bossDamageToday, date: snapshot.date });
      }
    }
  }
  return new Set([...bestByBossAndPlayer.entries()].map(([key, best]) => `${key}:${best.date}:${best.damage}`));
}

function personalBestKey(row, bossKey, date) {
  const identity = row?.playerId ?? row?.name;
  return `${bossKey}:${identity}:${date}:${row?.bossDamageToday}`;
}

function issue(type, date, actual, expected, rows, personalBestsAffected) {
  return {
    type,
    date,
    actualBoss: actual ? { key: actual.key, name: actual.name, weekday: actual.weekday } : null,
    expectedBoss: expected ? { key: expected.key, name: expected.name, weekday: expected.weekday } : null,
    rowsAffected: rows.length,
    personalBestsAffected,
  };
}

function previousDateForWeekday(date, weekday) {
  if (!Number.isInteger(weekday) || !validIsoDate(date)) return null;
  const current = new Date(`${date}T12:00:00Z`);
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(current);
    candidate.setUTCDate(current.getUTCDate() - offset);
    if (candidate.getUTCDay() === weekday) return candidate.toISOString().slice(0, 10);
  }
  return null;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function mondayFirst(weekday) {
  return weekday === 0 ? 7 : weekday;
}

function weekdayLabel(weekday) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] ?? null;
}
