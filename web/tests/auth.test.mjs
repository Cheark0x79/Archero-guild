import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_COOKIE_NAME, isPublicPath } from "../lib/auth.js";

test("only login, authentication assets, and health are public", () => {
  assert.equal(AUTH_COOKIE_NAME, "archero_admin_session");
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/api/auth/login"), true);
  assert.equal(isPublicPath("/api/auth/logout"), true);
  assert.equal(isPublicPath("/api/health"), true);
  assert.equal(isPublicPath("/_next/static/app.js"), true);
  assert.equal(isPublicPath("/dashboard"), false);
  assert.equal(isPublicPath("/api/members"), false);
  assert.equal(isPublicPath("/admin/check"), false);
});
