import assert from "node:assert/strict";
import test from "node:test";

import { chartPointsForRange, weeklyPowerDelta } from "../lib/chart-points.js";

const points = Array.from({ length: 35 }, (_, index) => ({
  date: `2026-07-${String(index + 1).padStart(2, "0")}`,
  value: 1_000_000 + index * 10_000,
})).filter((point) => !point.date.endsWith("32") && !point.date.endsWith("33") && !point.date.endsWith("34") && !point.date.endsWith("35"));

test("chart ranges retain at most seven evenly distributed real snapshots", () => {
  const week = chartPointsForRange(points, "week");
  const month = chartPointsForRange(points, "month");
  const all = chartPointsForRange(points, "all");
  assert.equal(week.length, 7);
  assert.equal(month.length, 7);
  assert.equal(all.length, 7);
  assert.equal(week[0].date, "2026-07-25");
  assert.equal(week.at(-1).date, "2026-07-31");
  assert.equal(month[0].date, "2026-07-02");
  assert.equal(month.at(-1).date, "2026-07-31");
  assert.equal(all[0].date, "2026-07-01");
  assert.equal(all.at(-1).date, "2026-07-31");
});

test("weekly power comparison uses the latest snapshot at least seven days earlier", () => {
  assert.equal(weeklyPowerDelta(points), 70_000);
  assert.equal(weeklyPowerDelta(points.slice(0, 4)), null);
});
