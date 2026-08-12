import assert from "node:assert/strict";
import test from "node:test";

import { buildBossWeekComparison } from "../lib/boss-week-comparison.js";

const bossKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function week(startDay, totals, participant = "active") {
  const start = new Date(`${startDay}T12:00:00Z`);
  return bossKeys.map((bossKey, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      bossKey,
      rows: [
        { playerId: participant, bossDamageToday: totals[index] },
        { playerId: "former", bossDamageToday: 999 },
      ],
    };
  });
}

test("boss comparison uses the latest complete rotation and compares the same boss", () => {
  const result = buildBossWeekComparison([
    ...week("2026-07-20", [100, 200, 300, 400, 500, 600, 700]),
    ...week("2026-07-27", [150, 100, 450, 400, 250, 900, 350]),
    ...week("2026-08-03", [999, 999, 999, 999, 999, 999]).slice(0, 6),
  ], {
    bossKeys,
    includePlayer: (playerId) => playerId === "active",
  });

  assert.equal(result.weekStart, "2026-07-27");
  assert.equal(result.weekEnd, "2026-08-02");
  assert.equal(result.previousWeekStart, "2026-07-20");
  assert.deepEqual(result.rows[0], {
    bossKey: "mon",
    date: "2026-07-27",
    total: 150,
    participants: 1,
    previousTotal: 100,
    deltaPercent: 50,
  });
  assert.equal(result.rows[1].deltaPercent, -50);
});

test("boss comparison returns null until a full seven-boss rotation exists", () => {
  assert.equal(buildBossWeekComparison(week("2026-08-03", [1, 2, 3, 4, 5, 6, 7]).slice(0, 6), { bossKeys }), null);
});

test("boss comparison does not show misleading deltas from an incomplete prior rotation", () => {
  const result = buildBossWeekComparison([
    ...week("2026-07-20", [100, 200, 300, 400, 500, 600, 700]).slice(0, 6),
    ...week("2026-07-27", [150, 100, 450, 400, 250, 900, 350]),
  ], { bossKeys, includePlayer: (playerId) => playerId === "active" });

  assert.equal(result.previousWeekStart, null);
  assert.equal(result.rows[0].previousTotal, null);
  assert.equal(result.rows[0].deltaPercent, null);
  assert.equal(result.rows[6].previousTotal, null);
  assert.equal(result.rows[6].deltaPercent, null);
});
