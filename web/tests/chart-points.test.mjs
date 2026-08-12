import assert from "node:assert/strict";
import test from "node:test";

import { adaptiveChartDomain, chartPointsForRange, completedSundayPoints, weeklyPowerDelta } from "../lib/chart-points.js";

const points = Array.from({ length: 35 }, (_, index) => ({
  date: `2026-07-${String(index + 1).padStart(2, "0")}`,
  value: 1_000_000 + index * 10_000,
})).filter((point) => !point.date.endsWith("32") && !point.date.endsWith("33") && !point.date.endsWith("34") && !point.date.endsWith("35"));

test("chart ranges retain at most seven evenly distributed real snapshots", () => {
  const week = chartPointsForRange(points, "week");
  const month = chartPointsForRange(points, "month");
  const twoMonths = chartPointsForRange(points, "twoMonths");
  const all = chartPointsForRange(points, "all");
  assert.equal(week.length, 7);
  assert.equal(month.length, 7);
  assert.equal(twoMonths.length, 7);
  assert.equal(all.length, 7);
  assert.equal(week[0].date, "2026-07-25");
  assert.equal(week.at(-1).date, "2026-07-31");
  assert.equal(month[0].date, "2026-07-02");
  assert.equal(month.at(-1).date, "2026-07-31");
  assert.equal(twoMonths[0].date, "2026-07-01");
  assert.equal(twoMonths.at(-1).date, "2026-07-31");
  assert.equal(all[0].date, "2026-07-01");
  assert.equal(all.at(-1).date, "2026-07-31");
});

test("weekly power comparison uses the latest snapshot at least seven days earlier", () => {
  assert.equal(weeklyPowerDelta(points), 70_000);
  assert.equal(weeklyPowerDelta(points.slice(0, 4)), null);
});

test("multi-week donation comparisons retain completed Sunday checkpoints only", () => {
  const sundays = completedSundayPoints(points, 4);
  assert.deepEqual(sundays.map((point) => point.date), ["2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26"]);
  assert.equal(completedSundayPoints(points, null, 2).length, 2);
});

test("adaptive chart domain keeps small changes visually proportional to their value level", () => {
  const domain = adaptiveChartDomain([657.98, 664.1, 670.85, 681.13]);
  assert.ok(Math.abs(domain.minimum - 533.329) < 0.001);
  assert.ok(Math.abs(domain.maximum - 805.781) < 0.001);
  assert.ok(Math.abs(domain.span - 272.452) < 0.001);
});

test("adaptive chart domain expands when the real change is large", () => {
  assert.deepEqual(adaptiveChartDomain([500, 620]), { minimum: 436, maximum: 684, span: 248 });
  const domain = adaptiveChartDomain([300, 650]);
  assert.ok(Math.abs(domain.minimum - 230) < 0.001);
  assert.ok(Math.abs(domain.maximum - 720) < 0.001);
  assert.ok(Math.abs(domain.span - 490) < 0.001);
});

test("adaptive chart domain handles constant, zero, invalid and empty series safely", () => {
  assert.deepEqual(adaptiveChartDomain([100, 100]), { minimum: 80, maximum: 120, span: 40 });
  assert.deepEqual(adaptiveChartDomain([0, 0]), { minimum: 0, maximum: 0.4, span: 0.4 });
  assert.deepEqual(adaptiveChartDomain([Number.NaN, 50]), { minimum: 40, maximum: 60, span: 20 });
  assert.deepEqual(adaptiveChartDomain([]), { minimum: 0, maximum: 1, span: 1 });
});
