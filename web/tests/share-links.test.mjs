import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  createMemberShareCode,
  createMemberShareToken,
  normalizeShareHours,
  shareCookieName,
  verifyMemberShareCode,
  verifyMemberShareToken,
} from "../lib/share-links.js";
import { sharedMemberProfileFromData } from "../lib/shared-member.js";
import {
  captures,
  dailyBossRawSnapshots,
  dailyRawSnapshots,
  guildRoster,
  memberSnapshots,
  previousMemberSnapshots,
  rules,
} from "../sample-data.js";
import { DEMO_PRIMARY_PLAYER_ID } from "../lib/demo-data.js";

const environment = { ARCHERO_SHARE_LINK_SECRET: "share-test-secret-that-is-longer-than-thirty-two-bytes" };
process.env.ARCHERO_SHARE_LINK_SECRET ??= environment.ARCHERO_SHARE_LINK_SECRET;
const now = new Date("2026-08-03T10:00:00.000Z");

test("member share codes are compact, signed, reusable, and time limited", () => {
  const code = createMemberShareCode(DEMO_PRIMARY_PLAYER_ID, { environment, now, expiresInHours: 2 });
  const firstGrant = verifyMemberShareCode(code, { environment, now: new Date("2026-08-03T10:30:00.000Z") });
  const secondGrant = verifyMemberShareCode(code, { environment, now: new Date("2026-08-03T11:30:00.000Z") });
  assert.ok(code.length <= 60);
  assert.equal(code.includes("."), false);
  assert.equal(firstGrant.playerId, DEMO_PRIMARY_PLAYER_ID);
  assert.equal(secondGrant.playerId, DEMO_PRIMARY_PLAYER_ID);
  assert.equal(firstGrant.expiresAt.toISOString(), "2026-08-03T12:00:00.000Z");
  assert.equal(verifyMemberShareCode(`${code.slice(0, -1)}x`, { environment, now }), null);
  assert.equal(verifyMemberShareCode(code, { environment, now: new Date("2026-08-03T12:00:00.000Z") }), null);
  assert.equal(verifyMemberShareCode(code, { environment: { ARCHERO_SHARE_LINK_SECRET: `${environment.ARCHERO_SHARE_LINK_SECRET}x` }, now }), null);
});

test("member share tokens are scoped, signed, reusable, and time limited", () => {
  const token = createMemberShareToken(DEMO_PRIMARY_PLAYER_ID, { environment, now, expiresInHours: 2 });
  const firstGrant = verifyMemberShareToken(token, { environment, now: new Date("2026-08-03T10:30:00.000Z") });
  const secondGrant = verifyMemberShareToken(token, { environment, now: new Date("2026-08-03T11:30:00.000Z") });
  assert.equal(firstGrant.playerId, DEMO_PRIMARY_PLAYER_ID);
  assert.equal(secondGrant.playerId, DEMO_PRIMARY_PLAYER_ID);
  assert.equal(firstGrant.expiresAt.toISOString(), "2026-08-03T12:00:00.000Z");
  assert.equal(verifyMemberShareToken(`${token}x`, { environment, now }), null);
  assert.equal(verifyMemberShareToken(token, { environment, now: new Date("2026-08-03T12:00:00.000Z") }), null);
  assert.equal(verifyMemberShareToken(token, { environment: { ARCHERO_SHARE_LINK_SECRET: `${environment.ARCHERO_SHARE_LINK_SECRET}x` }, now }), null);
});

test("share link expiry and cookie names are strictly validated", () => {
  assert.equal(normalizeShareHours(undefined), 24);
  assert.equal(normalizeShareHours(1), 1);
  assert.throws(() => normalizeShareHours(25), /between 1 and 24/);
  assert.throws(() => createMemberShareToken("not-an-id", { environment, now }), /playerId/);
  assert.equal(shareCookieName(DEMO_PRIMARY_PLAYER_ID), `archero_share_${DEMO_PRIMARY_PLAYER_ID}`);
});

test("shared member data contains charts and boss ranks without warnings or private administration", () => {
  const profile = sharedMemberProfileFromData({
    captures,
    guildRoster,
    memberSnapshots,
    previousMemberSnapshots,
    dailyRawSnapshots,
    dailyBossRawSnapshots,
    rules,
    memberAdminRecords: { [DEMO_PRIMARY_PLAYER_ID]: { notes: [{ note: "private" }] } },
    warningActions: { secret: { status: "ignored" } },
  }, DEMO_PRIMARY_PLAYER_ID, "https://archero.example.com");

  assert.equal(profile.member.playerId, DEMO_PRIMARY_PLAYER_ID);
  assert.ok(profile.powerHistory.length > 0);
  assert.equal(typeof profile.powerWeekDelta, "number");
  assert.ok(profile.bossDamageHistory.length > 0);
  assert.equal(profile.personalBests.length, 7);
  assert.equal(profile.personalBests.every((record) => record.boss.imagePath?.startsWith("/bosses/")), true);
  assert.equal(Object.hasOwn(profile, "warnings"), false);
  assert.equal(JSON.stringify(profile).includes("private"), false);
  assert.equal(JSON.stringify(profile).includes("warningActions"), false);
});

test("the shared page never calls mutable administration endpoints", async () => {
  const source = await fs.readFile(new URL("../app/shared/SharedMemberProfile.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /api\/member-admin|api\/warning-actions|api\/data/);
  assert.doesNotMatch(source, /Current warnings|Automatic warning history/);
});
