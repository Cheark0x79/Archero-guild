import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ROLE,
  AUTH_COOKIE_NAME,
  isAdminPath,
  isPublicPath,
  roleForSessionToken,
  USER_ROLE,
} from "../lib/auth.js";

test("only login, authentication assets, and health are public", () => {
  assert.equal(AUTH_COOKIE_NAME, "archero_session");
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/api/auth/login"), true);
  assert.equal(isPublicPath("/api/auth/logout"), true);
  assert.equal(isPublicPath("/api/health"), true);
  assert.equal(isPublicPath("/_next/static/app.js"), true);
  assert.equal(isPublicPath("/dashboard"), false);
  assert.equal(isPublicPath("/api/members"), false);
  assert.equal(isPublicPath("/admin/check"), false);
});

test("admin pages and data mutation APIs require the admin role", () => {
  assert.equal(isAdminPath("/admin"), true);
  assert.equal(isAdminPath("/admin/check"), true);
  assert.equal(isAdminPath("/api/data/upload"), true);
  assert.equal(isAdminPath("/dashboard"), false);
  assert.equal(isAdminPath("/api/dashboard-data"), false);
});

test("session tokens resolve to separate user and admin roles", () => {
  const environment = {
    ARCHERO_USER_SESSION_TOKEN: "user-token",
    ARCHERO_ADMIN_SESSION_TOKEN: "admin-token",
  };
  assert.equal(roleForSessionToken("user-token", environment), USER_ROLE);
  assert.equal(roleForSessionToken("admin-token", environment), ADMIN_ROLE);
  assert.equal(roleForSessionToken("invalid-token", environment), null);
});

test("an identical user and admin token never grants a role", () => {
  const environment = {
    ARCHERO_USER_SESSION_TOKEN: "shared-token",
    ARCHERO_ADMIN_SESSION_TOKEN: "shared-token",
  };
  assert.equal(roleForSessionToken("shared-token", environment), null);
});
