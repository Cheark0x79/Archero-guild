import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateWarningHistory,
  warningHistoryEvents,
  warningHistorySummary,
} from "../warning-history.js";

const rules = {
  maxInactiveDays: 3,
  minContribution7d: 500,
  minPowerGrowth14dPercent: 1,
  minBossTries: 2,
  newMemberGraceDays: 7,
};

test("warning history keeps a bad day after the next snapshot is healthy", () => {
  const rows = [
    { date: "2026-07-01", power: 1_000_000, contribution7d: 900, bossAttacks: 2, lastActivityDays: 0 },
    { date: "2026-07-15", power: 1_000_000, contribution7d: 100, bossAttacks: 0, lastActivityDays: 4 },
    { date: "2026-07-16", power: 1_020_000, contribution7d: 900, bossAttacks: 2, lastActivityDays: 0 },
  ];

  const history = evaluateWarningHistory(rows, rules);
  assert.deepEqual(
    history[1].warnings.map((warning) => warning.label),
    ["Game absence", "Low contribution", "Low progression", "Missed boss"],
  );
  assert.deepEqual(history[2].warnings, []);

  const events = warningHistoryEvents(rows, rules);
  assert.equal(events.length, 4);
  assert.equal(events.every((event) => event.date === "2026-07-15"), true);
  assert.equal(events.every((event) => event.severity === "warning"), true);
  assert.deepEqual(warningHistorySummary(events), {
    total: 4,
    byType: {
      game_absence: 1,
      low_contribution: 1,
      low_progression: 1,
      missed_boss: 1,
    },
    lastWarningAt: "2026-07-15",
  });
});

test("warning history respects the new member grace period", () => {
  const rows = [
    { date: "2026-07-15", power: 100, contribution7d: 0, bossAttacks: 0, lastActivityDays: 5 },
  ];

  const history = evaluateWarningHistory(rows, rules, { joinedAt: "2026-07-12" });

  assert.deepEqual(history[0].warnings, []);
});
