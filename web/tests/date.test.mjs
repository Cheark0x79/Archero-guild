import assert from "node:assert/strict";
import test from "node:test";

import { acceptedSnapshotDates, latestDataDate, localIsoDate } from "../date.js";

test("localIsoDate uses the Paris calendar day after midnight", () => {
  const instant = new Date("2026-07-28T22:12:00Z");

  assert.equal(localIsoDate(instant), "2026-07-29");
  assert.equal(localIsoDate(instant, "UTC"), "2026-07-28");
});

test("latestDataDate prefers accepted snapshots over the later import timestamp", () => {
  assert.equal(
    latestDataDate({
      snapshotDates: ["2026-07-27", "2026-07-28"],
      fallbacks: ["2026-07-29T00:21:00+02:00"],
    }),
    "2026-07-28",
  );
});

test("latestDataDate keeps the explicit member snapshot date", () => {
  assert.equal(
    latestDataDate({
      preferred: "2026-07-28",
      snapshotDates: ["2026-07-27"],
      fallbacks: ["2026-07-29T00:21:00+02:00"],
    }),
    "2026-07-28",
  );
});

test("acceptedSnapshotDates exposes only real unique snapshot days", () => {
  assert.deepEqual(
    acceptedSnapshotDates(["2026-07-28", "2026-07-27", "2026-07-28", null, "invalid"]),
    ["2026-07-27", "2026-07-28"],
  );
});
