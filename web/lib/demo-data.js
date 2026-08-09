import { defaultRules } from "../default-rules.js";

export const DEMO_SCENARIOS = Object.freeze(["baseline", "audit-anomalies", "record-variants", "sparse"]);
export const DEMO_PRIMARY_PLAYER_ID = "900000001";

const BOSS_ROTATION = [
  { key: "grim-reaper", weekday: 0, name: "Grim Reaper" },
  { key: "treant-guardian", weekday: 1, name: "Treant Guardian" },
  { key: "fire-dragon", weekday: 2, name: "Fire Dragon" },
  { key: "flame-demon", weekday: 3, name: "Flame Demon" },
  { key: "medusa", weekday: 4, name: "Medusa" },
  { key: "stoneman", weekday: 5, name: "Stoneman" },
  { key: "cyclops-mage", weekday: 6, name: "Cyclops Mage" },
];

const DEMO_NAMES = [
  "DemoAstra", "DemoBoreal", "DemoCipher", "DemoDahlia", "DemoEmber",
  "DemoFable", "DemoGlint", "DemoHarbor", "DemoIon", "DemoJuniper",
  "DemoKestrel", "DemoLumen", "DemoMosaic", "DemoNimbus", "DemoOrbit",
  "DemoPixel", "DemoQuartz", "DemoRipple", "DemoSolstice", "DemoTundra",
  "DemoUmber", "DemoVector", "DemoWillow", "DemoXenon", "DemoYonder",
  "DemoZenith", "DemoAurora", "DemoBeacon", "DemoComet", "DemoDrift",
  "DemoEcho", "DemoFlare", "DemoGrove", "DemoHelix", "DemoIndigo",
  "DemoJade", "DemoKite", "DemoLotus", "DemoMeteor", "DemoNova",
];

export function createDemoData(options = {}) {
  const seed = String(options.seed ?? "archero-web-demo-v1");
  const anchorDate = validDate(options.anchorDate ?? "2026-08-09");
  const scenario = validScenario(options.scenario ?? "baseline");
  const random = seededRandom(seed);
  const dates = Array.from({ length: 21 }, (_, index) => shiftDate(anchorDate, index - 20));
  const roster = makeRoster(random, dates);
  const activeMembers = roster.filter((member) => member.status === "active");
  const dailyRawSnapshots = dates.map((date, dayIndex) => ({
    date,
    rows: memberRowsForDay(activeMembers, date, dayIndex, random, scenario),
  }));
  const previousRows = dailyRawSnapshots.at(-2).rows.filter((row) => row.playerId);
  const latestRows = dailyRawSnapshots.at(-1).rows.filter((row) => row.playerId);
  const previousById = new Map(previousRows.map((row) => [row.playerId, previousSnapshot(row)]));
  const previousMemberSnapshots = [...previousById.values()];
  const memberSnapshots = latestRows.map((row) => currentSnapshot(row, previousById.get(row.playerId), roster));
  const dailyBossRawSnapshots = dates.map((date, dayIndex) => bossSnapshotForDay(activeMembers, date, dayIndex, scenario));

  return {
    captures: {
      guildName: "Demo Vanguard",
      lastCapturedAt: `${anchorDate}T20:30:00+02:00`,
      lastImportedAt: `${anchorDate}T20:35:00+02:00`,
      baselineJoinedAt: dates[0],
      contribution30d: Array.from({ length: 30 }, (_, index) => 12_000 + index * 710 + Math.floor(random() * 900)),
      averagePower8w: Array.from({ length: 8 }, (_, index) => 1_050_000 + index * 82_000),
    },
    guildRoster: roster,
    previousMemberSnapshots,
    memberSnapshots,
    dailyRawSnapshots,
    dailyBossRawSnapshots,
    rules: { ...defaultRules },
    changes: demoChanges(anchorDate, dates),
    ocrQueue: [],
  };
}

function makeRoster(random, dates) {
  return DEMO_NAMES.map((name, index) => {
    const status = index < 36 ? "active" : index < 38 ? "left" : index === 38 ? "kicked" : "inactive";
    const role = index === 0 ? "leader" : index < 3 ? "officer" : index < 7 ? "elder" : "member";
    return {
      playerId: String(900_000_001 + index),
      name: `${name}${String(index + 1).padStart(2, "0")}`,
      role,
      status,
      joinedAt: shiftDate(dates[0], -(index % 12)),
      ...(status !== "active" ? { leftAt: shiftDate(dates.at(-1), -(index - 34)) } : {}),
      discordLinked: status === "active" && index % 3 !== 0,
      ...(status === "active" && index % 5 === 0 ? { discordName: `demo_user_${String(index + 1).padStart(2, "0")}` } : {}),
      demoPowerBase: 540_000 + index * 73_000 + Math.floor(random() * 95_000),
    };
  }).map(({ demoPowerBase, ...member }) => ({ ...member, metadata: { demoPowerBase } }));
}

function memberRowsForDay(members, date, dayIndex, random, scenario) {
  const weekday = weekdayIndex(date);
  const rows = members.map((member, index) => {
    const basePower = member.metadata.demoPowerBase;
    const power = basePower + dayIndex * (4_000 + index * 115) + Math.floor(random() * 2_000);
    const donation = 90 + weekday * (105 + index * 9) + (dayIndex % 3) * 20;
    const attacks = (index + dayIndex) % 9 === 0 ? 0 : (index + dayIndex) % 7 === 0 ? 1 : 2;
    const sparse = scenario === "sparse" && (index === 31 || index === 34);
    return {
      playerId: member.playerId,
      name: member.name,
      role: member.role,
      power: sparse && index === 34 ? null : power,
      contribution7d: sparse && index === 31 ? null : donation,
      bossAttacks: sparse && index === 34 ? null : attacks,
      bossDamageToday: null,
      lastActivityDays: index === 35 ? 5 : index % 13 === 0 ? 2 : 0,
      lastSeenAt: date,
      metricsVerified: !sparse,
      verificationNote: `Synthetic member fixture: day ${dayIndex + 1}, row ${index + 1}.`,
    };
  });
  if (dayIndex === 9 || (scenario === "sparse" && dayIndex === 20)) {
    rows.push({
      playerId: null,
      name: `DemoUnresolved${dayIndex + 1}`,
      role: "member",
      power: 777_000,
      contribution7d: 420,
      bossAttacks: 2,
      bossDamageToday: null,
      lastActivityDays: 0,
      lastSeenAt: date,
      metricsVerified: false,
      verificationNote: `Synthetic unresolved fixture: day ${dayIndex + 1}.`,
    });
  }
  return rows;
}

function bossSnapshotForDay(members, date, dayIndex, scenario) {
  const expectedBoss = bossForDate(date);
  const rotated = [...members.slice(1 + dayIndex % 5), ...members.slice(1, 1 + dayIndex % 5)];
  const participants = [members[0], ...rotated.slice(0, 31)];
  const rows = participants.map((member, index) => {
    const rank = index + 1;
    let damage = Math.round((2_800_000_000_000 + dayIndex * 31_000_000_000) * Math.pow(0.78, index));
    if (scenario === "record-variants" && dayIndex === 17 && rank === 8) {
      damage = Math.round((2_800_000_000_000 + dayIndex * 31_000_000_000) * Math.pow(0.78, 6));
    }
    return {
      source: `synthetic/boss-${date}.png row ${index}`,
      rowIndex: index,
      area: rank <= 3 ? "podium" : "list",
      bossRank: rank,
      playerId: member.playerId,
      name: member.name,
      rawName: member.name,
      damageText: formatDamage(damage),
      bossDamageToday: damage,
      rowLabel: rank <= 3 ? `Top ${rank}` : `Boss row ${rank}`,
      lastSeenAt: date,
    };
  });
  if (scenario === "sparse" && dayIndex === 12) {
    rows.at(-1).playerId = null;
    rows.at(-1).name = "DemoUnresolvedBoss";
    rows.at(-1).rawName = "DemoUnresolvedBoss";
  }
  const snapshot = {
    date,
    bossKey: expectedBoss.key,
    rows,
  };
  if (scenario === "audit-anomalies" && dayIndex === 16) {
    const wrongBoss = BOSS_ROTATION[(expectedBoss.weekday + 6) % 7];
    snapshot.bossKey = wrongBoss.key;
  }
  if (scenario === "audit-anomalies" && dayIndex === 17) {
    delete snapshot.bossKey;
  }
  return snapshot;
}

function previousSnapshot(row) {
  return {
    playerId: row.playerId,
    role: row.role,
    power: row.power,
    contribution7d: row.contribution7d,
    bossAttacks: row.bossAttacks,
    lastActivityDays: row.lastActivityDays,
    lastSeenAt: row.lastSeenAt,
    verificationNote: row.verificationNote,
  };
}

function currentSnapshot(row, previous, roster) {
  const member = roster.find((item) => item.playerId === row.playerId);
  return {
    ...row,
    status: member?.status ?? "active",
    joinedAt: member?.joinedAt ?? null,
    power7d: null,
    power14dPercent: null,
    contributionToday: null,
    contributionTotal: null,
    bossDamageTotal: null,
    bossRank: null,
    bossAttacksDelta: numberDelta(row.bossAttacks, previous?.bossAttacks),
    contributionDelta: numberDelta(row.contribution7d, previous?.contribution7d),
    powerDelta: numberDelta(row.power, previous?.power),
    previousSnapshot: previous ?? null,
  };
}

function demoChanges(anchorDate, dates) {
  return [
    { type: "capture", title: "Synthetic test week loaded", detail: "Forty fictional identities and twenty-one generated days are available for Web testing.", at: anchorDate },
    { type: "join", title: "Demo newcomer joined", detail: "A fictional member exercises the new-member grace period.", at: dates.at(-5) },
    { type: "leave", title: "Demo departures recorded", detail: "Fictional former members exercise filters and historical records.", at: dates.at(-8) },
  ];
}

function seededRandom(seed) {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function validDate(value) {
  const text = String(value);
  const parsed = new Date(`${text}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("Demo anchor date must be a real YYYY-MM-DD date");
  }
  return text;
}

function validScenario(value) {
  if (!DEMO_SCENARIOS.includes(value)) throw new Error(`Unknown demo scenario: ${value}`);
  return value;
}

function shiftDate(value, offset) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function weekdayIndex(value) {
  return new Date(`${value}T12:00:00Z`).getUTCDay();
}

function bossForDate(value) {
  return BOSS_ROTATION.find((boss) => boss.weekday === weekdayIndex(value));
}

function numberDelta(current, previous) {
  return typeof current === "number" && typeof previous === "number" ? current - previous : null;
}

function formatDamage(value) {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}
