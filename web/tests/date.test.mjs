import assert from "node:assert/strict";
import test from "node:test";

import { localIsoDate } from "../date.js";

test("localIsoDate uses the Paris calendar day after midnight", () => {
  const instant = new Date("2026-07-28T22:12:00Z");

  assert.equal(localIsoDate(instant), "2026-07-29");
  assert.equal(localIsoDate(instant, "UTC"), "2026-07-28");
});
