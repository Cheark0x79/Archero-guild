import {
  captures,
  changes,
  dailyBossRawSnapshots,
  dailyRawSnapshots,
  guildRoster,
  memberSnapshots,
  previousMemberSnapshots,
  rules,
  ocrQueue,
} from "../../../sample-data.js";
import { runObserverModule } from "../data/actions.js";

export async function loadDashboardData() {
  const fallback = localPayload();
  if (!process.env.ARCHERO_DATABASE_URL && !process.env.DATABASE_URL) {
    return { ok: true, source: "local", data: fallback };
  }

  const result = await runObserverModule("observer.storage.export_json");
  if (!result.ok || !result.data || typeof result.data !== "object") {
    if (result.error) {
      console.warn("Dashboard database export unavailable; using local dashboard data.");
    }
    return {
      ok: true,
      source: "local",
      warning: "Database export unavailable; using local dashboard data.",
      data: fallback,
    };
  }

  return { ok: true, source: "database", data: mergeWithLocalFallback(result.data, fallback) };
}

export function bossRankingsFromData(data) {
  const currentPlayerIds = new Set((data.guildRoster ?? []).filter((member) => member.playerId && !isFormerStatus(member.status)).map((member) => member.playerId));
  const players = new Map();
  for (const day of data.dailyBossRawSnapshots ?? []) {
    const boss = bossForDate(day.date);
    for (const row of day.rows ?? []) {
      if (!currentPlayerIds.has(row.playerId) || typeof row.bossDamageToday !== "number") continue;
      const current = players.get(row.playerId) ?? {
        playerId: row.playerId,
        name: row.name ?? row.playerId,
        points: [],
      };
      current.name = row.name ?? current.name;
      current.points.push({
        date: day.date,
        bossKey: boss.key,
        bossName: boss.name,
        damage: row.bossDamageToday,
        bossRank: row.bossRank ?? null,
      });
      players.set(row.playerId, current);
    }
  }

  const allTime = [...players.values()]
    .map((player) => {
      const best = [...player.points].sort((left, right) => right.damage - left.damage || right.date.localeCompare(left.date))[0];
      return best ? { playerId: player.playerId, name: player.name, ...best } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name));

  const byBoss = BOSS_ROTATION.map((boss) => ({
    boss,
    rows: [...players.values()]
      .map((player) => {
        const best = player.points.filter((point) => point.bossKey === boss.key).sort((left, right) => right.damage - left.damage || right.date.localeCompare(left.date))[0];
        return best ? { playerId: player.playerId, name: player.name, ...best } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name)),
  }));

  const weeklyByPlayer = new Map();
  for (const player of players.values()) {
    for (const point of player.points) {
      const key = `${weekStart(point.date)}:${player.playerId}`;
      const current = weeklyByPlayer.get(key) ?? {
        weekStart: weekStart(point.date),
        playerId: player.playerId,
        name: player.name,
        damage: 0,
        bossDays: 0,
        bestDayDamage: 0,
      };
      current.damage += point.damage;
      current.bossDays += 1;
      current.bestDayDamage = Math.max(current.bestDayDamage, point.damage);
      weeklyByPlayer.set(key, current);
    }
  }

  const weekly = [...weeklyByPlayer.values()].sort(
    (left, right) => right.weekStart.localeCompare(left.weekStart) || right.damage - left.damage || left.name.localeCompare(right.name),
  );

  return { allTime, byBoss, weekly };
}

const BOSS_ROTATION = [
  { key: "treant-guardian", weekday: 1, dayLabel: "Mon", name: "Treant Guardian" },
  { key: "fire-dragon", weekday: 2, dayLabel: "Tue", name: "Fire Dragon" },
  { key: "flame-demon", weekday: 3, dayLabel: "Wed", name: "Flame Demon" },
  { key: "medusa", weekday: 4, dayLabel: "Thu", name: "Medusa" },
  { key: "stoneman", weekday: 5, dayLabel: "Fri", name: "Stoneman" },
  { key: "cyclops-mage", weekday: 6, dayLabel: "Sat", name: "Cyclops Mage" },
  { key: "grim-reaper", weekday: 0, dayLabel: "Sun", name: "Grim Reaper" },
];

function isFormerStatus(status) {
  return ["inactive", "left", "kicked"].includes(status);
}

function bossForDate(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return BOSS_ROTATION.find((boss) => boss.weekday === weekday) ?? BOSS_ROTATION[0];
}

function weekStart(date) {
  const current = new Date(`${date}T12:00:00Z`);
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - day + 1);
  return current.toISOString().slice(0, 10);
}

function localPayload() {
  return {
    captures,
    changes,
    dailyBossRawSnapshots,
    dailyRawSnapshots,
    guildRoster,
    memberSnapshots,
    previousMemberSnapshots,
    rules,
    ocrQueue,
  };
}

export function mergeWithLocalFallback(data, fallback) {
  return {
    captures: { ...fallback.captures, ...(data.captures ?? {}) },
    changes: arrayOrFallback(data.changes, fallback.changes),
    dailyBossRawSnapshots: arrayOrFallback(data.dailyBossRawSnapshots, fallback.dailyBossRawSnapshots),
    dailyRawSnapshots: arrayOrFallback(data.dailyRawSnapshots, fallback.dailyRawSnapshots),
    guildRoster: rosterOrFallback(data.guildRoster, fallback.guildRoster),
    memberSnapshots: arrayOrFallback(data.memberSnapshots, fallback.memberSnapshots),
    previousMemberSnapshots: arrayOrFallback(data.previousMemberSnapshots, fallback.previousMemberSnapshots),
    rules: { ...fallback.rules, ...(data.rules ?? {}) },
    ocrQueue: arrayOrFallback(data.ocrQueue, fallback.ocrQueue),
  };
}

function rosterOrFallback(value, fallback) {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const fallbackById = new Map((fallback ?? []).filter((member) => member.playerId).map((member) => [member.playerId, member]));
  return value.map((member) => {
    const local = member.playerId ? fallbackById.get(member.playerId) : null;
    if (!local) return member;
    const merged = {
      ...member,
      discordName: member.discordName ?? local.discordName,
      discordLinked: Boolean(member.discordLinked || local.discordLinked),
    };
    const searchAliases = member.searchAliases ?? local.searchAliases;
    if (searchAliases) merged.searchAliases = searchAliases;
    return merged;
  });
}

function arrayOrFallback(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}
