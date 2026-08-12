import assert from "node:assert/strict";
import test from "node:test";

import { buildDonationChartDays, DAILY_DONATION_PER_MEMBER, donationTarget, latestDonationWeekPoints } from "../lib/donation-chart.js";

test("weekly donation chart uses each member's daily gain instead of cumulative totals", () => {
  const days = buildDonationChartDays([
    { date: "2026-08-03", rows: [{ playerId: "1", contribution7d: 100 }, { playerId: "2", contribution7d: 200 }] },
    { date: "2026-08-04", rows: [{ playerId: "1", contribution7d: 400 }, { playerId: "2", contribution7d: 500 }] },
    { date: "2026-08-05", rows: [{ playerId: "1", contribution7d: 450 }, { playerId: "2", contribution7d: 550 }] },
  ]);

  assert.deepEqual(days, [
    { date: "2026-08-03", total: 300, cumulative: 300, count: 2 },
    { date: "2026-08-04", total: 600, cumulative: 900, count: 2 },
    { date: "2026-08-05", total: 100, cumulative: 1000, count: 2 },
  ]);
});

test("weekly donation gain restarts from the captured cumulative value after Monday reset", () => {
  const days = buildDonationChartDays([
    { date: "2026-08-09", rows: [{ playerId: "1", contribution7d: 900 }] },
    { date: "2026-08-10", rows: [{ playerId: "1", contribution7d: 120 }] },
  ]);

  assert.equal(days[0].total, 900);
  assert.equal(days[1].total, 120);
});

test("weekly donation gain treats a lower cumulative value as a reset even within the same calendar week", () => {
  const days = buildDonationChartDays([
    { date: "2026-08-05", rows: [{ playerId: "1", contribution7d: 900 }] },
    { date: "2026-08-06", rows: [{ playerId: "1", contribution7d: 120 }] },
  ]);

  assert.equal(days[0].total, 900);
  assert.equal(days[1].total, 120);
});

test("donation chart excludes players outside the current guild roster", () => {
  const days = buildDonationChartDays([
    { date: "2026-08-03", rows: [{ playerId: "active", contribution7d: 500 }, { playerId: "former", contribution7d: 500 }] },
  ], (playerId) => playerId === "active");

  assert.deepEqual(days, [{ date: "2026-08-03", total: 500, cumulative: 500, count: 1 }]);
});

test("donation target uses current member count rather than guild capacity", () => {
  assert.equal(DAILY_DONATION_PER_MEMBER, 500);
  assert.equal(donationTarget(41), 20_500);
  assert.equal(donationTarget(41, 7), 143_500);
  assert.equal(donationTarget(null), null);
});

test("one-week donations start on Monday of the latest captured week", () => {
  const points = latestDonationWeekPoints([
    { date: "2026-08-01", total: 500 },
    { date: "2026-08-02", total: 0 },
    { date: "2026-08-03", total: 600 },
    { date: "2026-08-04", total: 700 },
    { date: "2026-08-08", total: 800 },
  ]);

  assert.deepEqual(points.map((point) => point.date), ["2026-08-03", "2026-08-04", "2026-08-08"]);
});
