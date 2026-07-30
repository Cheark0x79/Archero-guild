import test from "node:test";
import assert from "node:assert/strict";

import { checkApiRateLimit, resetApiRateLimitForTest } from "../app/api/v1/_lib/rate-limit.js";

function requestFrom(address) {
  return { headers: new Headers({ "cf-connecting-ip": address }) };
}

test("API rate limiting applies a configurable per-principal minute bucket", () => {
  resetApiRateLimitForTest();
  const environment = { ARCHERO_API_RATE_LIMIT_PER_MINUTE: "2" };
  const now = Date.UTC(2026, 6, 28, 12, 0, 0);

  assert.equal(checkApiRateLimit(requestFrom("127.0.0.1"), "key-a", environment, now).allowed, true);
  assert.equal(checkApiRateLimit(requestFrom("127.0.0.1"), "key-a", environment, now + 1).allowed, true);
  const rejected = checkApiRateLimit(requestFrom("127.0.0.1"), "key-a", environment, now + 2);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.ok(rejected.retryAfterSeconds > 0);

  assert.equal(checkApiRateLimit(requestFrom("127.0.0.1"), "key-b", environment, now + 2).allowed, true);
  assert.equal(checkApiRateLimit(requestFrom("127.0.0.1"), "key-a", environment, now + 60_001).allowed, true);
  resetApiRateLimitForTest();
});

test("API rate limiting can be disabled explicitly", () => {
  resetApiRateLimitForTest();
  const result = checkApiRateLimit(
    requestFrom("127.0.0.1"),
    "key-a",
    { ARCHERO_API_RATE_LIMIT_PER_MINUTE: "0" },
    0,
  );

  assert.equal(result.allowed, true);
  assert.equal(result.limit, 0);
});
