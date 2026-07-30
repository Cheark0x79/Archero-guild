import test from "node:test";
import assert from "node:assert/strict";

import { authorizeApiRequest } from "../app/api/v1/_lib/auth.js";
import {
  bossCatalogFromData,
  bossDaysFromData,
  bossRankings,
  findMember,
  guildSummaryFromData,
  memberHistoryFromData,
  memberBossesFromData,
  memberRankingsFromData,
  memberWarningsFromData,
  membersFromData,
  queryMembers,
  resolveMemberFromData,
  rulesFromData,
  violationsFromData,
  warningRankingsFromData,
  warningsFromData,
} from "../app/api/v1/_lib/domain.js";

function requestWith(headers = {}) {
  return { headers: new Headers(headers) };
}

const data = {
  captures: { lastCapturedAt: "2026-07-22T10:00:00Z", lastImportedAt: "2026-07-22T10:05:00Z" },
  guildRoster: [
    { playerId: "123", name: "Alice", discordLinked: true, status: "active" },
    { playerId: "456", name: "Bob", status: "left" },
  ],
  memberSnapshots: [
    {
      playerId: "123",
      role: "officer",
      power: 900000,
      contribution7d: 1200,
      bossAttacks: 2,
      lastActivityDays: 0,
      lastSeenAt: "2026-07-22",
      metricsVerified: true,
    },
  ],
  dailyBossRawSnapshots: [
    {
      date: "2026-07-21",
      rows: [{ playerId: "123", name: "Alice", bossDamageToday: 5000, bossRank: 1 }],
    },
  ],
  rules: {
    memberCapacity: 40,
    maxInactiveDays: 3,
    minContribution7d: 500,
    minPowerGrowth14dPercent: 1,
    minBossTries: 2,
    newMemberGraceDays: 7,
  },
};

test("API authentication accepts bearer and x-api-key credentials", () => {
  assert.equal(authorizeApiRequest(requestWith(), "").authorized, true);
  assert.equal(authorizeApiRequest(requestWith(), "secret").reason, "missing_api_key");
  assert.equal(authorizeApiRequest(requestWith({ authorization: "Bearer secret" }), "secret").authorized, true);
  assert.equal(authorizeApiRequest(requestWith({ "x-api-key": "second" }), "first, second").authorized, true);
  assert.equal(authorizeApiRequest(requestWith({ authorization: "Bearer wrong" }), "secret").reason, "invalid_api_key");
});

test("API authentication fails closed when production has no configured key", () => {
  const result = authorizeApiRequest(requestWith(), "", { NODE_ENV: "production" });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, "api_not_configured");
});

test("public members exclude private notes and support search and pagination", () => {
  const members = membersFromData(data);
  assert.equal(members[0].name, "Alice");
  assert.equal(members[0].metrics.power, 900000);
  assert.equal("officerNote" in members[0], false);

  const result = queryMembers(members, new URLSearchParams({ q: "ali", limit: "1" }));
  assert.deepEqual(result.items.map((member) => member.playerId), ["123"]);
  assert.equal(result.pagination.total, 1);
  assert.equal(findMember(members, "456").name, "Bob");
});

test("public member filtering validates status and pagination", () => {
  const members = membersFromData(data);
  assert.deepEqual(queryMembers(members, new URLSearchParams()).items.map((member) => member.name), ["Alice"]);
  assert.deepEqual(queryMembers(members, new URLSearchParams({ status: "former" })).items.map((member) => member.name), ["Bob"]);
  assert.equal(queryMembers(members, new URLSearchParams({ status: "unknown" })).error.code, "invalid_status");
  assert.equal(queryMembers(members, new URLSearchParams({ limit: "0" })).error.code, "invalid_pagination");
});

test("guild summary and boss ranking are shaped for bot commands", () => {
  const summary = guildSummaryFromData(data);
  assert.equal(summary.currentMembers, 1);
  assert.equal(summary.discordLinked, 1);

  const ranking = bossRankings(data, "all-time", new URLSearchParams({ limit: "5" }));
  assert.equal(ranking.items[0].name, "Alice");
  assert.equal(ranking.items[0].damage, 5000);
});

test("rules and violations expose actionable guild compliance", () => {
  assert.equal(rulesFromData(data).minContribution7d, 500);
  const violatingData = {
    ...data,
    memberSnapshots: [{ ...data.memberSnapshots[0], contribution7d: 100, bossAttacks: 0, lastActivityDays: 5 }],
  };
  const result = violationsFromData(violatingData, new URLSearchParams());
  assert.equal(result.summary.totalMembers, 1);
  assert.deepEqual(result.items[0], {
    playerId: "123",
    name: "Alice",
    lastSeenAt: "2026-07-22",
    evaluation: {
      status: "Absent",
      warnings: [
        { type: "game_absence", label: "Game absence" },
        { type: "low_contribution", label: "Low contribution" },
        { type: "missed_boss", label: "Missed boss" },
      ],
    },
  });
  assert.deepEqual(result.summary.warningCountsByType, {
    game_absence: 1,
    low_contribution: 1,
    missed_boss: 1,
  });
});

test("warning endpoints fail explicitly when evaluation rules are missing", () => {
  const incomplete = { ...data, rules: {} };

  assert.equal(violationsFromData(incomplete, new URLSearchParams()).error.code, "rules_not_configured");
  assert.equal(violationsFromData(incomplete, new URLSearchParams()).error.status, 503);
  assert.equal(warningsFromData(incomplete, new URLSearchParams()).error.code, "rules_not_configured");
  assert.equal(warningRankingsFromData(incomplete, new URLSearchParams()).error.code, "rules_not_configured");
});

test("an excused warning stays in history but leaves the actionable watchlist", () => {
  const excusedData = {
    ...data,
    memberSnapshots: [{ ...data.memberSnapshots[0], contribution7d: 100 }],
    dailyRawSnapshots: [{
      date: "2026-07-22",
      rows: [{ playerId: "123", power: 900000, contribution7d: 100, bossAttacks: 2, lastActivityDays: 0 }],
    }],
    warningActions: {
      "123:2026-07-22:low_contribution": {
        playerId: "123",
        date: "2026-07-22",
        type: "low_contribution",
        status: "excused",
        note: "Absence announced.",
        updatedAt: "2026-07-22T12:00:00.000Z",
      },
    },
  };
  const result = violationsFromData(excusedData, new URLSearchParams());
  assert.equal(result.items.length, 0);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].action.status, "excused");
});

test("an ignored warning no longer counts in the current list or ranking", () => {
  const ignoredData = {
    ...data,
    memberSnapshots: [{ ...data.memberSnapshots[0], contribution7d: 100 }],
    dailyRawSnapshots: [{
      date: "2026-07-22",
      rows: [{ playerId: "123", power: 900000, contribution7d: 100, bossAttacks: 2, lastActivityDays: 0 }],
    }],
    warningActions: {
      "123:2026-07-22:low_contribution": {
        playerId: "123",
        date: "2026-07-22",
        type: "low_contribution",
        status: "ignored",
        note: "",
        updatedAt: "2026-07-22T12:00:00.000Z",
      },
    },
  };

  assert.equal(violationsFromData(ignoredData, new URLSearchParams()).items.length, 0);
  assert.equal(warningRankingsFromData(ignoredData, new URLSearchParams()).rankings.length, 0);
});

test("member rankings support power, contribution, attacks, deltas, and activity", () => {
  const result = memberRankingsFromData(data, new URLSearchParams({ metric: "power", limit: "5" }));
  assert.equal(result.metric, "power");
  assert.equal(result.order, "desc");
  assert.deepEqual(result.items[0], {
    rank: 1,
    playerId: "123",
    name: "Alice",
    role: "officer",
    value: 900000,
    lastSeenAt: "2026-07-22",
    links: {
      api: "/api/v1/members/123",
      web: "/members/123",
    },
  });
  assert.equal(memberRankingsFromData(data, new URLSearchParams({ metric: "unknown" })).error.code, "invalid_metric");
});

test("member rankings can return the lowest donations with their guild positions", () => {
  const rankingData = {
    ...data,
    guildRoster: [
      ...data.guildRoster,
      { playerId: "789", name: "Charlie", status: "active" },
    ],
    memberSnapshots: [
      ...data.memberSnapshots,
      {
        playerId: "789",
        role: "member",
        contribution7d: 100,
        lastSeenAt: "2026-07-22",
        metricsVerified: true,
      },
    ],
  };
  const result = memberRankingsFromData(rankingData, new URLSearchParams({ metric: "contribution7d", order: "asc" }));
  assert.equal(result.items[0].name, "Charlie");
  assert.equal(result.items[0].rank, 2);
  assert.equal(result.items[0].belowMinimum, true);
  assert.equal(memberRankingsFromData(data, new URLSearchParams({ order: "sideways" })).error.code, "invalid_order");
});

test("member resolver accepts IDs, normalized names, aliases, and typos", () => {
  const resolverData = {
    ...data,
    guildRoster: [
      {
        playerId: "123",
        name: "Mundõ",
        previousNames: ["Old Mundo"],
        discordName: "Mundo",
        searchAliases: ["Chef"],
        status: "active",
      },
    ],
  };
  assert.equal(resolveMemberFromData(resolverData, new URLSearchParams({ q: "123" })).match.matchedBy, "playerId");
  assert.equal(resolveMemberFromData(resolverData, new URLSearchParams({ q: "mundo" })).match.playerId, "123");
  assert.equal(resolveMemberFromData(resolverData, new URLSearchParams({ q: "chef" })).match.matchedBy, "alias");
  assert.equal(resolveMemberFromData(resolverData, new URLSearchParams({ q: "old mundo" })).match.matchedBy, "previousName");
  assert.equal(resolveMemberFromData(resolverData, new URLSearchParams({ q: "mndo" })).match.playerId, "123");
  assert.equal(resolveMemberFromData(resolverData, new URLSearchParams()).error.code, "missing_query");
});

test("member history and boss results can be filtered", () => {
  const historicalData = {
    ...data,
    rules: { ...data.rules, minPowerGrowth14dPercent: 1 },
    dailyRawSnapshots: [
      { date: "2026-07-01", rows: [{ playerId: "123", power: 800000, contribution7d: 900, bossAttacks: 2, lastActivityDays: 0 }] },
      { date: "2026-07-21", rows: [{ playerId: "123", power: 800000, contribution7d: 100, bossAttacks: 1, lastActivityDays: 5 }] },
      { date: "2026-07-22", rows: [{ playerId: "123", power: 900000, contribution7d: 1200, bossAttacks: 2 }] },
    ],
  };
  const history = memberHistoryFromData(historicalData, "123", new URLSearchParams({ from: "2026-07-22" }));
  assert.deepEqual(history.items.map((row) => row.date), ["2026-07-22"]);
  assert.deepEqual(history.items[0].warnings, []);
  const fullHistory = memberHistoryFromData(historicalData, "123", new URLSearchParams());
  assert.deepEqual(
    fullHistory.items.find((row) => row.date === "2026-07-21").warnings.map((warning) => warning.label),
    ["Game absence", "Low contribution", "Low progression", "Missed boss"],
  );
  assert.equal(fullHistory.warningSummary.total, 4);

  const violations = violationsFromData(historicalData, new URLSearchParams());
  assert.equal(violations.history.some((event) => event.date === "2026-07-21" && event.label === "Missed boss"), true);
  assert.equal(violations.historyPagination.totalWarnings, 4);
  assert.equal(violations.historyPagination.hasMore, false);
  const limitedViolations = violationsFromData(historicalData, new URLSearchParams({
    playerId: "123",
    from: "2026-07-21",
    to: "2026-07-21",
    limit: "2",
  }));
  assert.equal(limitedViolations.history.length, 2);
  assert.equal(limitedViolations.historyPagination.totalWarnings, 4);
  assert.equal(limitedViolations.historyPagination.hasMore, true);
  assert.equal(violationsFromData(historicalData, new URLSearchParams({ limit: "0" })).error.code, "invalid_limit");
  assert.equal(violationsFromData(historicalData, new URLSearchParams({ from: "2026-07-22", to: "2026-07-21" })).error.code, "invalid_date_range");

  const bossDays = bossDaysFromData(data, new URLSearchParams({ date: "2026-07-21" }));
  assert.equal(bossDays.items[0].boss.key, "fire-dragon");
  assert.equal(bossDays.items[0].rows[0].damage, 5000);
  assert.equal(bossCatalogFromData(data).length, 7);
  assert.equal(memberHistoryFromData(historicalData, "123", new URLSearchParams({ from: "2026-02-31" })).error.code, "invalid_date");
  assert.equal(memberHistoryFromData(historicalData, "123", new URLSearchParams({ from: "2026-07-22", to: "2026-07-21" })).error.code, "invalid_date_range");
});

test("warning list, ranking, and member detail expose current and historical data", () => {
  const warningData = {
    ...data,
    guildRoster: [
      ...data.guildRoster,
      { playerId: "789", name: "Charlie", status: "active" },
    ],
    dailyRawSnapshots: [
      {
        date: "2026-07-21",
        rows: [
          { playerId: "123", power: 900000, contribution7d: 100, bossAttacks: 0, lastActivityDays: 5 },
          { playerId: "789", power: 500000, contribution7d: 100, bossAttacks: 1, lastActivityDays: 0 },
        ],
      },
      {
        date: "2026-07-22",
        rows: [
          { playerId: "123", power: 900000, contribution7d: 100, bossAttacks: 0, lastActivityDays: 5 },
          { playerId: "789", power: 500000, contribution7d: 700, bossAttacks: 2, lastActivityDays: 0 },
        ],
      },
    ],
  };

  const currentBoss = warningsFromData(warningData, new URLSearchParams({
    type: "missed_boss",
    scope: "current",
  }));
  assert.equal(currentBoss.summary.totalWarnings, 1);
  assert.equal(currentBoss.warnings[0].playerId, "123");
  assert.equal(currentBoss.warnings[0].value, 0);

  const history = warningsFromData(warningData, new URLSearchParams({
    scope: "history",
    from: "2026-07-21",
  }));
  assert.equal(history.summary.totalWarnings, 8);
  assert.equal("danger" in history.summary, false);
  assert.equal(history.warnings.every((event) => !("severity" in event)), true);
  assert.equal(history.pagination.hasMore, false);

  const ranking = warningRankingsFromData(warningData, new URLSearchParams());
  assert.deepEqual(Object.keys(ranking).sort(), ["rankings", "totalMembers"]);
  assert.equal(ranking.rankings[0].playerId, "123");
  assert.equal(ranking.rankings[0].totalWarnings, 6);
  assert.deepEqual(
    Object.keys(ranking.rankings[0]).sort(),
    ["lastWarningAt", "name", "playerId", "rank", "totalWarnings", "warningCountsByType"],
  );
  assert.equal("danger" in ranking.rankings[0], false);
  assert.equal("warning" in ranking.rankings[0], false);
  assert.equal(ranking.rankings[1].playerId, "789");
  assert.equal(ranking.rankings[1].totalWarnings, 2);

  const violations = violationsFromData(warningData, new URLSearchParams({
    type: "missed_boss",
    playerId: "123",
  }));
  assert.equal(violations.items.every((member) => member.playerId === "123"), true);
  assert.equal(violations.history.length, 2);
  assert.equal(violations.history.every((event) => event.type === "missed_boss" && event.playerId === "123"), true);
  assert.equal(violations.history.every((event) => !("severity" in event)), true);
  assert.equal("danger" in violations.summary, false);
  assert.equal(violations.warningSummary.totalWarnings, 2);

  const memberWarnings = memberWarningsFromData(warningData, "123", new URLSearchParams());
  assert.equal(memberWarnings.playerId, "123");
  assert.equal(memberWarnings.summary.totalWarnings, 6);
  assert.equal(memberWarnings.warnings.every((event) =>
    Object.keys(event).every((key) =>
      ["date", "type", "label", "value", "threshold", "baselineDate"].includes(key),
    )
  ), true);

  assert.equal(warningsFromData(warningData, new URLSearchParams({ type: "unknown" })).error.code, "invalid_warning_type");
  assert.equal(violationsFromData(warningData, new URLSearchParams({ type: "unknown" })).error.code, "invalid_warning_type");
  assert.equal(warningRankingsFromData(warningData, new URLSearchParams({ scope: "future" })).error.code, "invalid_scope");
});

test("boss results prefer the boss identity stored by PostgreSQL over weekday inference", () => {
  const explicitBossData = {
    ...data,
    bossDefinitions: [
      { key: "special-boss", weekday: 4, dayLabel: "Special", name: "Special Boss" },
    ],
    dailyBossRawSnapshots: [
      {
        date: "2026-07-21",
        bossKey: "special-boss",
        rows: [{ playerId: "123", name: "Alice", bossDamageToday: 5000, bossRank: 1 }],
      },
    ],
  };

  const result = bossDaysFromData(explicitBossData, new URLSearchParams());

  assert.equal(result.items[0].boss.key, "special-boss");
  assert.equal(result.items[0].boss.name, "Special Boss");
});

test("member boss profile returns records and guild ranks for every boss", () => {
  const result = memberBossesFromData(data, "123");
  assert.equal(result.member.name, "Alice");
  assert.equal(result.globalRecord.damage, 5000);
  assert.equal(result.recordsByBoss.length, 7);
  assert.equal(result.recordsByBoss.find((item) => item.boss.key === "fire-dragon").guildRank, 1);
  assert.equal(memberBossesFromData(data, "missing"), null);
});
