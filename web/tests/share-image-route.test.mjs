import test from "node:test";
import assert from "node:assert/strict";

import { checkApiRateLimit, resetApiRateLimitForTest } from "../app/api/v1/_lib/rate-limit.js";
import { createMemberShareCode } from "../lib/share-links.js";
import { shareImagePath } from "../lib/share-image.js";
import { shareImageResponse } from "../lib/share-image-response.js";
import { sharedMemberProfileFromData } from "../lib/shared-member.js";
import * as sample from "../sample-data.js";

process.env.ARCHERO_SHARE_LINK_SECRET ??= "synthetic-test-share-secret-over-thirty-two-bytes";

const data = { ...sample };
const playerId = sample.memberSnapshots.find((row) => row.playerId)?.playerId;
const origin = "http://localhost:3000";
const loadData = async () => ({ ok: true, data });
const renderPng = async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

function share() {
  const code = createMemberShareCode(playerId);
  const version = new URL(shareImagePath(code, sharedMemberProfileFromData(data, playerId)), origin).searchParams.get("version");
  return { code, version };
}

function imageRequest(code, version, options = {}) {
  const query = version === undefined ? "" : `?version=${version}`;
  return shareImageResponse(new Request(`${origin}/s/${code}/image${query}`), code, { renderPng, loadData, ...options });
}

test.beforeEach(() => {
  resetApiRateLimitForTest();
  globalThis.__archeroShareImageActive = 0;
});

test("invalid share codes are rejected without spending the global image budget", async () => {
  for (let index = 0; index < 40; index += 1) {
    assert.equal((await imageRequest(`junk-${index}`, "a".repeat(64))).status, 410);
  }
  const { code, version } = share();
  const response = await imageRequest(code, version);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("image route rejects missing, malformed and outdated versions", async () => {
  const { code } = share();
  assert.equal((await imageRequest(code)).status, 410);
  assert.equal((await imageRequest(code, "not-a-hash")).status, 410);
  const outdated = await imageRequest(code, "0".repeat(64));
  assert.equal(outdated.status, 410);
  assert.match(await outdated.text(), /Profile changed/);
});

test("image route enforces the render concurrency cap and the global budget", async () => {
  const { code, version } = share();
  globalThis.__archeroShareImageActive = 2;
  assert.equal((await imageRequest(code, version)).status, 429);
  globalThis.__archeroShareImageActive = 0;

  const request = new Request(`${origin}/`);
  for (let index = 0; index < 30; index += 1) {
    checkApiRateLimit(request, "share-image-global", { ARCHERO_API_RATE_LIMIT_PER_MINUTE: "30" });
  }
  const limited = await imageRequest(code, version);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
});

test("image route fails closed on unavailable data, oversize or failed renders", async () => {
  const { code, version } = share();
  assert.equal((await imageRequest(code, version, { loadData: async () => ({ ok: false }) })).status, 503);
  assert.equal((await imageRequest(code, version, { renderPng: async () => new ArrayBuffer(5 * 1024 * 1024 + 1) })).status, 503);
  assert.equal((await imageRequest(code, version, { renderPng: async () => { throw new Error("boom"); } })).status, 503);
  assert.equal(globalThis.__archeroShareImageActive, 0);
});
