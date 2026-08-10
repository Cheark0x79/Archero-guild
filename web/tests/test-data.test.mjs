import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createSyntheticImportBatches,
  databaseContainsOnlySyntheticMembers,
  syntheticTestDataAllowed,
} from "../lib/test-data.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("synthetic database loading requires an explicit isolated loopback environment", () => {
  const allowed = {
    ARCHERO_DEPLOYMENT_ENV: "test",
    ARCHERO_ENABLE_TEST_DATA_ADMIN: "1",
    ARCHERO_ENVIRONMENT_ID: "t-record-hero",
    ARCHERO_DATABASE_URL: "postgresql://test",
    ARCHERO_PUBLIC_ORIGIN: "http://127.0.0.1:15447",
  };
  assert.equal(syntheticTestDataAllowed(allowed), true);
  assert.equal(syntheticTestDataAllowed({ ...allowed, ARCHERO_REQUIRE_DATABASE: "1" }), false);
  assert.equal(syntheticTestDataAllowed({ ...allowed, ARCHERO_DEPLOYMENT_ENV: "production" }), false);
  assert.equal(syntheticTestDataAllowed({ ...allowed, ARCHERO_DEPLOYMENT_ENV: "staging" }), false);
  assert.equal(syntheticTestDataAllowed({ ...allowed, ARCHERO_ENVIRONMENT_ID: "main" }), false);
  assert.equal(syntheticTestDataAllowed({ ...allowed, ARCHERO_PUBLIC_ORIGIN: "https://guild.example.com" }), false);
  assert.equal(syntheticTestDataAllowed({ ...allowed, ARCHERO_ENABLE_TEST_DATA_ADMIN: "0" }), false);
});

test("synthetic batches provide deterministic Web history without real identities", () => {
  const first = createSyntheticImportBatches();
  const second = createSyntheticImportBatches();
  assert.deepEqual(first, second);
  assert.equal(first.length, 21);
  assert.equal(first.at(-1).members.filter((member) => member.playerId).length, 36);
  assert.equal(first.reduce((total, batch) => total + batch.bossRankings.length, 0), 672);
  assert.equal(first.every((batch) => batch.members.every((member) => member.name.startsWith("Demo"))), true);
  assert.equal(first.every((batch) => batch.idempotencyKey.startsWith("synthetic-web-admin-v1:")), true);
});

test("the loader refuses to mix synthetic fixtures with another roster", () => {
  assert.equal(databaseContainsOnlySyntheticMembers([]), true);
  assert.equal(databaseContainsOnlySyntheticMembers([{ playerId: "900000001", name: "DemoAstra01" }]), true);
  assert.equal(databaseContainsOnlySyntheticMembers([{ playerId: "123", name: "Real member" }]), false);
  assert.equal(databaseContainsOnlySyntheticMembers([{ playerId: "900000001", name: "Unexpected" }]), false);
});

test("the admin control and route keep independent client and server guards", () => {
  const dashboard = fs.readFileSync(path.join(projectRoot, "web", "app", "components", "DashboardApp.jsx"), "utf8");
  const sidebar = fs.readFileSync(path.join(projectRoot, "web", "app", "components", "AppSidebar.jsx"), "utf8");
  const testPage = fs.readFileSync(path.join(projectRoot, "web", "app", "test", "page.jsx"), "utf8");
  const route = fs.readFileSync(path.join(projectRoot, "web", "app", "api", "data", "test-data", "route.js"), "utf8");
  assert.match(dashboard, /activeRoute === "test" && <TestEnvironmentView/);
  assert.doesNotMatch(dashboard, /activeRoute === "admin" && <TestDataPanel/);
  assert.match(sidebar, /NEXT_PUBLIC_TEST_DATA_ADMIN === "1"/);
  assert.match(sidebar, /NEXT_PUBLIC_DEPLOYMENT_ENV/);
  assert.match(testPage, /ARCHERO_ENABLE_TEST_DATA_ADMIN === "1"/);
  assert.match(testPage, /dynamic = "force-dynamic"/);
  assert.match(testPage, /notFound\(\)/);
  assert.match(dashboard, /headers: dataActionHeaders\(\)/);
  assert.match(dashboard, /Clear synthetic data/);
  assert.doesNotMatch(dashboard, /dashboardActionHeaders/);
  assert.match(route, /role !== ADMIN_ROLE/);
  assert.match(route, /syntheticTestDataAllowed\(\)/);
  assert.match(route, /hasDashboardActionHeader\(request\)/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /archero_guild\.storage\.clear_synthetic_data/);
  assert.doesNotMatch(route, /api\/v1\/imports/);
});
