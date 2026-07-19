import test from "node:test";
import assert from "node:assert/strict";
import {
  activityLabel,
  buildSummary,
  compareSourceRows,
  evaluateMember,
  filterMembers,
  formatBossDamageText,
  formatCompact,
  formatPowerDetail,
  lineChartPath,
  mergeRosterMetrics,
  newMemberDay,
  parseBossDamageText,
  sortMembers,
} from "../metrics.js";

const rules = {
  maxInactiveDays: 3,
  minContribution7d: 500,
  minPowerGrowth14dPercent: 1,
  minBossTries: 2,
  memberCapacity: 30,
};

const member = {
  playerId: "123456789",
  name: "PlayerA",
  previousNames: ["OldA"],
  discord: "@playerA",
  role: "member",
  status: "active",
  contribution7d: 800,
  bossDamageToday: 100,
  bossAttacks: 2,
  power14dPercent: 2,
  lastActivityDays: 0,
  metricsCaptured: true,
  metricsVerified: true,
};

test("evaluateMember marks healthy member active", () => {
  assert.deepEqual(evaluateMember(member, rules), {
    status: "Active",
    flags: [],
    severity: "positive",
  });
});

test("evaluateMember detects inactive and low contribution", () => {
  const result = evaluateMember(
    {
      ...member,
      contribution7d: 120,
      bossAttacks: 0,
      power14dPercent: 0.3,
      lastActivityDays: 5,
    },
    rules,
  );

  assert.equal(result.status, "Absent");
  assert.equal(result.severity, "danger");
  assert.deepEqual(result.flags, [
    "Game absence",
    "Low contribution",
    "Low progression",
    "Missed boss",
  ]);
});

test("evaluateMember does not mark missing metrics as inactive", () => {
  const result = evaluateMember(
    {
      playerId: "123456790",
      name: "Missing",
      role: "member",
      status: "active",
      metricsCaptured: false,
    },
    rules,
  );

  assert.equal(result.status, "Not recorded");
  assert.equal(result.severity, "neutral");
  assert.deepEqual(result.flags, ["Metrics not recorded"]);
});

test("evaluateMember does not apply guild rules to unverified metrics", () => {
  const result = evaluateMember(
    {
      ...member,
      metricsVerified: false,
      contribution7d: 0,
      bossDamageToday: 0,
      power14dPercent: 0,
      lastActivityDays: 8,
    },
    rules,
  );

  assert.equal(result.status, "Needs review");
  assert.equal(result.severity, "warning");
  assert.deepEqual(result.flags, ["Metrics need verification"]);
});

test("evaluateMember ignores missing partial metrics", () => {
  const result = evaluateMember(
    {
      ...member,
      contribution7d: 1932,
      bossAttacks: 1,
      power14dPercent: null,
      lastActivityDays: null,
    },
    rules,
  );

  assert.equal(result.status, "Watch");
  assert.equal(result.severity, "warning");
  assert.deepEqual(result.flags, ["Missed boss"]);
});

test("evaluateMember suppresses watch alerts during new member grace period", () => {
  const newRules = {
    ...rules,
    currentDate: "2026-07-15",
    newMemberGraceDays: 7,
  };
  const result = evaluateMember(
    {
      ...member,
      joinedAt: "2026-07-09",
      contribution7d: 0,
      bossAttacks: 0,
      bossDamageToday: 0,
    },
    newRules,
  );

  assert.equal(newMemberDay({ ...member, joinedAt: "2026-07-09" }, newRules), 7);
  assert.equal(result.status, "Active");
  assert.equal(result.severity, "positive");
  assert.deepEqual(result.flags, ["New member grace period"]);
});

test("evaluateMember marks kicked members as former records", () => {
  const result = evaluateMember(
    {
      playerId: null,
      name: "Former",
      status: "kicked",
      metricsCaptured: false,
    },
    rules,
  );

  assert.equal(result.status, "Kicked");
  assert.equal(result.severity, "neutral");
  assert.deepEqual(result.flags, ["Not in current guild"]);
});

test("buildSummary aggregates guild metrics", () => {
  const summary = buildSummary(
    [
      { ...member, contribution7d: 800, bossDamageToday: 100, status: "active" },
      { ...member, playerId: "2", contribution7d: 200, bossDamageToday: 0, bossAttacks: 0, status: "inactive", lastActivityDays: 4 },
    ],
    rules,
  );

  assert.equal(summary.members, "1/30");
  assert.equal(summary.currentMembers, 1);
  assert.equal(summary.formerMembers, 1);
  assert.equal(summary.activeToday, 1);
  assert.equal(summary.totalContribution, 800);
  assert.equal(summary.totalContributionDelta, 0);
  assert.equal(summary.bossDamage, 100);
  assert.equal(summary.bossAttacks, 2);
  assert.equal(summary.bossAttacksDelta, 0);
  assert.equal(summary.watchCount, 0);
  assert.equal(summary.knownIds, 1);
  assert.equal(summary.unresolvedIds, 0);
  assert.equal(summary.capturedMetrics, 1);
  assert.equal(summary.verifiedMetrics, 1);
  assert.equal(summary.reviewRequired, 0);
  assert.equal(summary.discordLinked, 0);
  assert.equal(summary.discordMissing, 1);
});

test("filterMembers searches name history and status", () => {
  const rows = filterMembers([member], rules, "olda", "active");
  assert.equal(rows.length, 1);
  assert.equal(filterMembers([member], rules, "missing", "active").length, 0);
  assert.equal(filterMembers([{ ...member, metricsVerified: false }], rules, "", "review").length, 1);
  assert.equal(filterMembers([{ ...member, status: "kicked" }], rules, "", "all").length, 0);
  assert.equal(filterMembers([{ ...member, status: "kicked" }], rules, "", "former").length, 1);
});

test("filterMembers matches normalized names", () => {
  const rows = mergeRosterMetrics(
    [
      {
        playerId: "120015522",
        name: "Mundõ",
        discordName: "Mundo",
        discordLinked: true,
      },
    ],
    [],
  );

  assert.equal(filterMembers(rows, rules, "Mundo", "all").length, 1);
  assert.equal(filterMembers(rows, rules, "Mundõ", "all").length, 1);
});

test("sortMembers sorts discord linked members first by default direction", () => {
  const rows = [
    { ...member, name: "MissingDiscord", discordLinked: false },
    { ...member, name: "OnDiscord", playerId: "2", discordLinked: true },
  ];

  assert.equal(sortMembers(rows, rules, { key: "discord", direction: "desc" })[0].name, "OnDiscord");
  assert.equal(sortMembers(rows, rules, { key: "discord", direction: "asc" })[0].name, "MissingDiscord");
});

test("sortMembers sorts numeric columns and keeps missing values last", () => {
  const rows = [
    { ...member, name: "NoDonation", contribution7d: null },
    { ...member, name: "LowDonation", playerId: "2", contribution7d: 100 },
    { ...member, name: "HighDonation", playerId: "3", contribution7d: 2000 },
  ];

  assert.deepEqual(
    sortMembers(rows, rules, { key: "donation", direction: "desc" }).map((row) => row.name),
    ["HighDonation", "LowDonation", "NoDonation"],
  );
  assert.deepEqual(
    sortMembers(rows, rules, { key: "donation", direction: "asc" }).map((row) => row.name),
    ["LowDonation", "HighDonation", "NoDonation"],
  );
});

test("sortMembers sorts roles by guild hierarchy", () => {
  const rows = [
    { ...member, name: "Member", role: "member" },
    { ...member, name: "Leader", playerId: "2", role: "leader" },
    { ...member, name: "Elder", playerId: "3", role: "elder" },
    { ...member, name: "Vice", playerId: "4", role: "officer" },
  ];

  assert.deepEqual(
    sortMembers(rows, rules, { key: "role", direction: "asc" }).map((row) => row.name),
    ["Leader", "Vice", "Elder", "Member"],
  );
});

test("sortMembers sorts capture by last seen date", () => {
  const rows = [
    { ...member, name: "Old", lastSeenAt: "2026-07-15" },
    { ...member, name: "Latest", playerId: "2", lastSeenAt: "2026-07-16" },
    { ...member, name: "Missing", playerId: "3", lastSeenAt: null },
  ];

  assert.deepEqual(
    sortMembers(rows, rules, { key: "capture", direction: "desc" }).map((row) => row.name),
    ["Latest", "Old", "Missing"],
  );
});

test("compareSourceRows sorts by screenshot name then row number", () => {
  const rows = [
    { name: "D", source: "members-001.png row 4" },
    { name: "B", source: "guild-members-001.png row 2" },
    { name: "A", source: "guild-members-001.png row 0" },
    { name: "C", source: "guild-members-002.png row 1" },
    { name: "E", source: "boss/boss-001.png row 0" },
    { name: "F", source: "boss/boss-001.png podium 1" },
  ];

  assert.deepEqual(
    [...rows].sort(compareSourceRows).map((row) => row.source),
    [
      "boss/boss-001.png podium 1",
      "boss/boss-001.png row 0",
      "guild-members-001.png row 0",
      "guild-members-001.png row 2",
      "guild-members-002.png row 1",
      "members-001.png row 4",
    ],
  );
});

test("activityLabel returns English labels", () => {
  assert.equal(activityLabel(0), "Today");
  assert.equal(activityLabel(1), "Yesterday");
  assert.equal(activityLabel(4), "4 days ago");
});

test("formatCompact keeps useful precision for power values", () => {
  assert.equal(formatCompact(511640), "511.64K");
  assert.equal(formatCompact(720000), "720K");
  assert.equal(formatCompact(1300000), "1.30M");
  assert.equal(formatCompact(5850000), "5.85M");
});

test("formatPowerDetail keeps at most two decimals", () => {
  assert.equal(formatPowerDetail(5003667), "5M");
  assert.equal(formatPowerDetail(5010000), "5.01M");
  assert.equal(formatPowerDetail(1320000), "1.32M");
});

test("parseBossDamageText converts game damage units", () => {
  assert.equal(parseBossDamageText("354.44 billion"), 354_440_000_000);
  assert.equal(parseBossDamageText("38.35 billions"), 38_350_000_000);
  assert.equal(parseBossDamageText("1.25T"), 1_250_000_000_000);
  assert.equal(parseBossDamageText(".1 billion"), 100_000_000);
  assert.equal(parseBossDamageText("443.65 million"), 443_650_000);
  assert.equal(parseBossDamageText("bad"), null);
});

test("formatBossDamageText keeps game-like display", () => {
  assert.equal(formatBossDamageText(1_250_000_000_000), "1.25T");
  assert.equal(formatBossDamageText(354_440_000_000), "354.44B");
  assert.equal(formatBossDamageText(100_000_000), "100M");
  assert.equal(formatBossDamageText(null, ".1 billion"), "0.1B");
  assert.equal(formatBossDamageText(null, "623.60 billion"), "623.60B");
  assert.equal(formatBossDamageText(null), "Not recorded");
});

test("lineChartPath returns drawable paths", () => {
  const chart = lineChartPath([10, 20, 15], 300, 120);
  assert.match(chart.line, /^M /);
  assert.match(chart.area, / Z$/);
});

test("mergeRosterMetrics keeps unresolved IDs and marks missing captures", () => {
  const rows = mergeRosterMetrics(
    [
      { playerId: "119945896", name: "5m4" },
      { playerId: null, name: "Dronkar", discordLinked: true },
    ],
    [{ ...member, playerId: "119945896", contribution7d: 1000 }],
  );

  assert.equal(rows[0].name, "5m4");
  assert.equal(rows[0].metricsCaptured, true);
  assert.equal(rows[0].metricsVerified, true);
  assert.equal(rows[0].contribution7d, 1000);
  assert.equal(rows[1].playerId, null);
  assert.equal(rows[1].metricsCaptured, false);
  assert.equal(rows[1].metricsVerified, false);
  assert.equal(rows[1].discordLinked, true);
});

test("mergeRosterMetrics preserves former roster status", () => {
  const rows = mergeRosterMetrics([{ playerId: null, name: "Dronkar", status: "kicked", leftAt: "2026-07-15" }], []);

  assert.equal(rows[0].status, "kicked");
  assert.equal(rows[0].leftAt, "2026-07-15");
});
