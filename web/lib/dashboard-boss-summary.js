import { bossDefinitionForDate, bossDefinitionForSnapshot } from "./boss-identity.js";

export function buildDashboardBossSummary({
  today,
  snapshots = [],
  participationSnapshots = snapshots,
  definitions = [],
  memberCount = null,
  includePlayer = () => true,
} = {}) {
  const yesterday = addDaysIso(today, -1);
  const yesterdaySnapshot = Array.isArray(snapshots)
    ? snapshots.find((snapshot) => snapshot?.date === yesterday) ?? null
    : null;
  const latestAvailableSnapshot = Array.isArray(snapshots)
    ? snapshots
        .filter((snapshot) => snapshot?.date && snapshot.date < today)
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date))
        .at(-1) ?? null
    : null;
  const resultSnapshot = yesterdaySnapshot ?? latestAvailableSnapshot;
  const participationSnapshot = Array.isArray(participationSnapshots)
    ? participationSnapshots.find((snapshot) => snapshot?.date === resultSnapshot?.date) ?? resultSnapshot
    : resultSnapshot;
  const participants = participationSnapshot
    ? new Set(
        (participationSnapshot.rows ?? [])
          .filter((row) => includePlayer(row.playerId) && hasBossAttempt(row))
          .map((row) => row.playerId),
      ).size
    : null;

  return {
    today,
    todayBoss: bossDefinitionForDate(today, definitions),
    yesterday,
    resultDate: resultSnapshot?.date ?? yesterday,
    resultBoss: resultSnapshot
      ? bossDefinitionForSnapshot(resultSnapshot, definitions)
      : bossDefinitionForDate(yesterday, definitions),
    resultCaptured: Boolean(resultSnapshot),
    resultIsYesterday: Boolean(yesterdaySnapshot),
    participants,
    memberCount: Number.isFinite(memberCount) ? memberCount : null,
  };
}

function hasBossAttempt(row) {
  return (Number.isFinite(row?.bossAttacks) && row.bossAttacks > 0)
    || (Number.isFinite(row?.bossDamageToday) && row.bossDamageToday > 0);
}

function addDaysIso(value, days) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
