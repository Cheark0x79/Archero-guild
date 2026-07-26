import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviews } from "../app/api/data/reviews/validation.js";

test("normalizes structured field reviews and keeps legacy statuses", () => {
  assert.deepEqual(
    normalizeReviews({
      "2026-07-25:members-001.png row 0": {
        status: "invalid",
        fields: { power: " Power ", contribution7d: "Donation" },
      },
      "2026-07-25:legacy": "valid",
    }),
    {
      "2026-07-25:members-001.png row 0": {
        status: "invalid",
        fields: { power: "Power", contribution7d: "Donation" },
      },
      "2026-07-25:legacy": "valid",
    },
  );
});

test("rejects invalid reviews without a precise field", () => {
  assert.throws(
    () => normalizeReviews({ "2026-07-25:row 0": { status: "invalid", fields: {} } }),
    /requires a field/,
  );
  assert.throws(
    () => normalizeReviews({ "2026-07-25:row 0": { status: "invalid", fields: { unknown: "Unknown" } } }),
    /invalid review field/,
  );
});
