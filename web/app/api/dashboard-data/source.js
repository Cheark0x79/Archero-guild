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

export async function loadDashboardData(options = {}) {
  const environment = options.environment ?? process.env;
  if (!environment.ARCHERO_DATABASE_URL && !environment.DATABASE_URL) {
    return {
      ok: true,
      source: "local",
      dataMode: "demo",
      partial: false,
      missingDomains: [],
      data: localPayload(),
    };
  }

  const cache = dashboardCache();
  const now = Date.now();
  if (!options.bypassCache && cache.value && cache.expiresAt > now) {
    return cache.value;
  }
  if (cache.inFlight) return cache.inFlight;

  const runExport = options.runExport ?? (() => runObserverModule("observer.storage.export_json"));
  const request = Promise.resolve()
    .then(runExport)
    .then((result) => {
      if ((!result.ok || !result.data || typeof result.data !== "object") && result.error) {
        console.warn("Dashboard database export unavailable; returning no live data.");
      }
      const payload = dashboardPayloadFromDatabaseExport(result);
      const ttl = payload.dataMode === "live"
        ? cacheTtl(environment.ARCHERO_DATA_CACHE_TTL_MS, 15_000)
        : cacheTtl(environment.ARCHERO_DATA_ERROR_CACHE_TTL_MS, 2_000);
      if (ttl > 0) {
        cache.value = payload;
        cache.expiresAt = Date.now() + ttl;
      }
      return payload;
    })
    .finally(() => {
      if (cache.inFlight === request) cache.inFlight = null;
    });
  cache.inFlight = request;
  return request;
}

export function invalidateDashboardDataCache() {
  const cache = dashboardCache();
  cache.value = null;
  cache.expiresAt = 0;
}

export function resetDashboardDataCacheForTest() {
  const cache = dashboardCache();
  cache.value = null;
  cache.expiresAt = 0;
  cache.inFlight = null;
}

export function dashboardPayloadFromDatabaseExport(result) {
  if (!result?.ok || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    return unavailableDatabasePayload("Database export unavailable; no live data returned.");
  }
  const missingDomains = DATA_DOMAINS.filter((key) => !hasValidDomain(result.data, key));
  if (missingDomains.length === DATA_DOMAINS.length) {
    return unavailableDatabasePayload("Database export returned an invalid payload; no live data returned.");
  }
  return {
    ok: true,
    source: "database",
    dataMode: "live",
    partial: missingDomains.length > 0,
    missingDomains,
    data: normalizeDatabasePayload(result.data),
  };
}

function unavailableDatabasePayload(warning) {
  return {
    ok: false,
    source: "database",
    dataMode: "unavailable",
    partial: true,
    missingDomains: [...DATA_DOMAINS],
    warning,
    data: emptyPayload(),
  };
}

export function bossRankingsFromData(data) {
  const bossDefinitions = bossDefinitionsFromData(data);
  const currentPlayerIds = new Set((data.guildRoster ?? []).filter((member) => member.playerId && !isFormerStatus(member.status)).map((member) => member.playerId));
  const players = new Map();
  for (const day of data.dailyBossRawSnapshots ?? []) {
    const boss = bossDefinitionFromSnapshot(data, day);
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

  const byBoss = bossDefinitions.map((boss) => ({
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

export function bossDefinitionFromSnapshot(data, snapshot) {
  const definitions = bossDefinitionsFromData(data);
  const explicitKey = snapshot?.boss?.key ?? snapshot?.bossKey;
  if (explicitKey) {
    const stored = definitions.find((boss) => boss.key === explicitKey);
    return stored ?? {
      key: explicitKey,
      weekday: snapshot?.boss?.weekday ?? null,
      dayLabel: snapshot?.boss?.dayLabel ?? null,
      name: snapshot?.boss?.name ?? explicitKey,
    };
  }
  return bossForDate(snapshot?.date, definitions);
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

function bossDefinitionsFromData(data) {
  return Array.isArray(data.bossDefinitions) && data.bossDefinitions.length > 0
    ? data.bossDefinitions
    : BOSS_ROTATION;
}

function bossForDate(date, definitions = BOSS_ROTATION) {
  const [year, month, day] = String(date).split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return definitions.find((boss) => boss.weekday === weekday) ?? definitions[0] ?? BOSS_ROTATION[0];
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
    bossDefinitions: BOSS_ROTATION,
    dailyRawSnapshots,
    guildRoster,
    memberSnapshots,
    previousMemberSnapshots,
    rules,
    ocrQueue,
  };
}

const DATA_DOMAINS = [
  "captures",
  "changes",
  "dailyBossRawSnapshots",
  "bossDefinitions",
  "dailyRawSnapshots",
  "guildRoster",
  "memberSnapshots",
  "previousMemberSnapshots",
  "rules",
  "ocrQueue",
];
const REQUIRED_RULE_KEYS = [
  "maxInactiveDays",
  "minContribution7d",
  "minPowerGrowth14dPercent",
  "minBossTries",
  "newMemberGraceDays",
  "memberCapacity",
];

function emptyPayload() {
  return {
    captures: {
      lastCapturedAt: null,
      lastImportedAt: null,
      baselineJoinedAt: null,
      contribution30d: [],
      averagePower8w: [],
    },
    changes: [],
    dailyBossRawSnapshots: [],
    bossDefinitions: [],
    dailyRawSnapshots: [],
    guildRoster: [],
    memberSnapshots: [],
    previousMemberSnapshots: [],
    rules: {},
    ocrQueue: [],
  };
}

export function normalizeDatabasePayload(data) {
  const empty = emptyPayload();
  return {
    captures: { ...empty.captures, ...objectOrDefault(data.captures, {}) },
    changes: arrayOrEmpty(data.changes),
    dailyBossRawSnapshots: arrayOrEmpty(data.dailyBossRawSnapshots),
    bossDefinitions: arrayOrEmpty(data.bossDefinitions),
    dailyRawSnapshots: arrayOrEmpty(data.dailyRawSnapshots),
    guildRoster: arrayOrEmpty(data.guildRoster),
    memberSnapshots: arrayOrEmpty(data.memberSnapshots),
    previousMemberSnapshots: arrayOrEmpty(data.previousMemberSnapshots),
    rules: objectOrDefault(data.rules, {}),
    ocrQueue: arrayOrEmpty(data.ocrQueue),
  };
}

// Retained for internal compatibility with existing imports. Database payloads
// are no longer completed with demo values.
export function mergeWithLocalFallback(data, fallback) {
  void fallback;
  return normalizeDatabasePayload(data);
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrDefault(value, fallback) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function hasValidDomain(data, key) {
  if (!(key in data)) return false;
  if (key === "captures") {
    return Boolean(data[key]) && typeof data[key] === "object" && !Array.isArray(data[key]);
  }
  if (key === "rules") {
    return Boolean(data.rules)
      && typeof data.rules === "object"
      && !Array.isArray(data.rules)
      && REQUIRED_RULE_KEYS.every((ruleKey) => typeof data.rules[ruleKey] === "number");
  }
  return Array.isArray(data[key]);
}

function dashboardCache() {
  if (!globalThis.__archeroDashboardDataCache) {
    globalThis.__archeroDashboardDataCache = { value: null, expiresAt: 0, inFlight: null };
  }
  return globalThis.__archeroDashboardDataCache;
}

function cacheTtl(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(300_000, Math.floor(parsed)));
}
