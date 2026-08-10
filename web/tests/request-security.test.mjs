import assert from "node:assert/strict";
import test from "node:test";
import {
  createFailureRateLimiter,
  readLimitedJson,
  requestClientAddress,
  RequestLimitError,
  requireContentLength,
} from "../lib/request-security.js";

test("readLimitedJson accepts small JSON and rejects oversized streams", async () => {
  const accepted = new Request("http://localhost/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "small" }),
  });
  assert.deepEqual(await readLimitedJson(accepted, 128), { password: "small" });

  const rejected = new Request("http://localhost/login", {
    method: "POST",
    body: JSON.stringify({ password: "x".repeat(256) }),
  });
  await assert.rejects(() => readLimitedJson(rejected, 64), RequestLimitError);
});

test("requireContentLength rejects missing and oversized multipart declarations", () => {
  assert.throws(() => requireContentLength(new Request("http://localhost/upload"), 100), /required/);
  assert.throws(
    () => requireContentLength(new Request("http://localhost/upload", { headers: { "content-length": "101" } }), 100),
    /too large/,
  );
  assert.equal(requireContentLength(new Request("http://localhost/upload", { headers: { "content-length": "100" } }), 100), 100);
});

test("failure limiter locks a client for the configured window and clears on success", () => {
  const limiter = createFailureRateLimiter({ maximumAttempts: 2, windowMs: 1000 });
  assert.equal(limiter.check("client", 0).allowed, true);
  limiter.recordFailure("client", 0);
  assert.equal(limiter.check("client", 1).allowed, true);
  limiter.recordFailure("client", 2);
  assert.equal(limiter.check("client", 3).allowed, false);
  assert.equal(limiter.check("client", 1000).allowed, true);
  limiter.recordFailure("client", 1001);
  limiter.clear("client");
  assert.equal(limiter.check("client", 1002).allowed, true);
});

test("client address uses the first conventional forwarded address", () => {
  const request = new Request("http://localhost/login", {
    headers: {
      "x-forwarded-for": "198.51.100.5, 198.51.100.6",
    },
  });
  assert.equal(requestClientAddress(request), "198.51.100.5");
});
