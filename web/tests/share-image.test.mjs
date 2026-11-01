import test from "node:test";
import assert from "node:assert/strict";
import { shareImageModel, shareImageVersion, shareImagePath } from "../lib/share-image.js";
import { sharedMemberProfileFromData } from "../lib/shared-member.js";
import * as sample from "../sample-data.js";

process.env.ARCHERO_SHARE_LINK_SECRET ??= "synthetic-test-share-secret-over-thirty-two-bytes";

const data = { ...sample, memberAdminRecords: { secret: "PRIVATE_SENTINEL" }, warningActions: { secret: "PRIVATE_SENTINEL" } };
const playerId = sample.memberSnapshots.find((row) => row.playerId)?.playerId;

test("PNG projection excludes private data, bounds charts, and versions visible changes", () => {
  const profile = sharedMemberProfileFromData(data, playerId);
  assert.ok(profile);
  const model = shareImageModel(profile);
  assert.ok(model.powerHistory.length > 0 && model.powerHistory.length <= 7);
  assert.ok(model.bossHistory.length <= 7);
  assert.equal(model.records.length, 7);
  assert.ok(!JSON.stringify(model).includes("PRIVATE_SENTINEL"));
  assert.equal(shareImageVersion(model), shareImageVersion(shareImageModel({ ...profile, notes: "private", warnings: ["secret"] })));
  assert.notEqual(shareImageVersion(model), shareImageVersion({ ...model, power: model.power + 1 }));
  assert.match(shareImagePath("code", profile), /^\/s\/code\/image\?version=[a-f0-9]{64}$/);
});

test("boss progression compares personal records only within the same boss", () => {
  const profile = sharedMemberProfileFromData(data, playerId);
  assert.ok(profile.bossProgressions.length > 1);
  for (const boss of profile.bossProgressions) {
    assert.ok(boss.points.length);
    assert.ok(boss.points.every((point, index) => index === 0 || point.value >= boss.points[index - 1].value));
    const record = profile.personalBests.find((record) => record.boss.key === boss.key);
    assert.equal(boss.points.at(-1).value, record.bestDamage);
  }
});


test("PNG names never require remote font or emoji loading", () => {
  const profile = sharedMemberProfileFromData(data, playerId);
  assert.equal(shareImageModel({ ...profile, member: { ...profile.member, name: "한국어 🔥" } }).name, `Player ${playerId}`);
  assert.equal(shareImageModel({ ...profile, member: { ...profile.member, name: "Élodie" } }).name, "Elodie");
});

test("real PNG rendering uses no external network and has bounded dimensions", async () => {
  const { ImageResponse } = await import("next/og.js");
  const { renderShareImage } = await import("../lib/share-image-render.js");
  const originalFetch = globalThis.fetch;
  let externalRequests = 0;
  globalThis.fetch = async (input, ...args) => {
    if (String(input).startsWith("data:")) return originalFetch(input, ...args);
    externalRequests++;
    throw new Error("External network forbidden in PNG rendering");
  };
  try {
    const profile = sharedMemberProfileFromData(data, playerId);
    const model = shareImageModel({ ...profile, member: { ...profile.member, name: "한국어 🔥" } });
    const render = async () => Buffer.from(await new ImageResponse(renderShareImage(model), { width: 1200, height: 900 }).arrayBuffer());
    const png = await render();
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 900);
    assert.ok(png.length < 5 * 1024 * 1024);
    assert.deepEqual(png, await render());
    assert.equal(externalRequests, 0);
  } finally { globalThis.fetch = originalFetch; }
});
