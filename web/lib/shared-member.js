import {
  bossDaysFromData,
  findMember,
  memberBossesFromData,
  memberHistoryFromData,
  memberRankingsFromData,
  membersFromData,
} from "../app/api/v1/_lib/domain.js";
import { weeklyPowerDelta } from "./chart-points.js";

export function sharedMemberProfileFromData(data, playerId, publicOrigin = "") {
  const member = findMember(membersFromData(data, publicOrigin), playerId);
  if (!member) return null;

  const historyResult = memberHistoryFromData(data, playerId, new URLSearchParams());
  const history = (historyResult.items ?? []).map((row) => ({
    date: row.date,
    power: row.power ?? null,
    contribution7d: row.contribution7d ?? null,
    bossAttacks: row.bossAttacks ?? null,
  }));
  const latestSnapshot = history.at(-1) ?? null;
  const powerRanking = memberRankingsFromData(
    data,
    new URLSearchParams({ metric: "power", order: "desc", limit: "100" }),
    publicOrigin,
  );
  const powerRank = powerRanking.items?.find((row) => row.playerId === playerId)?.rank ?? null;
  const bossProfile = memberBossesFromData(data, playerId, publicOrigin);
  const bossDays = bossDaysFromData(data, new URLSearchParams({ playerId, limit: "100" }));
  const bossResults = (bossDays.items ?? [])
    .flatMap((day) => (day.rows ?? []).map((row) => ({
      date: day.date,
      boss: day.boss,
      damage: row.damage,
      damageText: row.damageText,
      guildRank: row.rank,
    })))
    .sort((left, right) => left.date.localeCompare(right.date));

  const powerHistory = history.filter((row) => typeof row.power === "number").map((row) => ({ date: row.date, value: row.power }));

  return {
    member: {
      playerId: member.playerId,
      name: member.name,
      role: member.role,
      guildStatus: member.guildStatus,
      lastSeenAt: member.lastSeenAt,
      metrics: {
        power: member.metrics.power,
        powerDelta: member.metrics.powerDelta,
        contribution7d: member.metrics.contribution7d,
        contributionDelta: member.metrics.contributionDelta,
      },
    },
    checkpointDate: latestSnapshot?.date ?? null,
    previousDayBossAttacks: latestSnapshot?.bossAttacks ?? null,
    powerWeekDelta: weeklyPowerDelta(powerHistory),
    powerRank: { rank: powerRank, total: powerRanking.total ?? 0 },
    powerHistory,
    bossDamageHistory: bossResults.map((row) => ({ date: row.date, value: row.damage, bossName: row.boss?.name ?? "Boss" })),
    recentBossResults: [...bossResults].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5),
    personalBests: (bossProfile?.recordsByBoss ?? []).map((record) => ({
      boss: record.boss,
      bestDamage: record.bestDamage,
      bestDate: record.bestDate,
      guildRank: record.guildRank,
      rankedMembers: bossRankedMembers(data, record.boss?.key),
    })),
  };
}

function bossRankedMembers(data, bossKey) {
  const result = bossDaysFromData(data, new URLSearchParams({ boss: bossKey, limit: "100" }));
  return new Set((result.items ?? []).flatMap((day) => day.rows ?? []).map((row) => row.playerId).filter(Boolean)).size;
}
