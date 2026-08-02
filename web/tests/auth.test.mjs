import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ROLE,
  applicationUrl,
  AUTH_COOKIE_NAME,
  isAdminPath,
  isLocalOcrPath,
  isPublicPath,
  roleForSessionToken,
  USER_ROLE,
} from "../lib/auth.js";
import { absolutePublicUrl, publicApiOrigin } from "../app/api/v1/_lib/urls.js";

test("public application origin overrides an internal proxy URL", () => {
  const environment = { ARCHERO_PUBLIC_ORIGIN: "https://archero.example.com" };
  assert.equal(
    applicationUrl("/login", "http://localhost:5181/dashboard", environment).href,
    "https://archero.example.com/login",
  );
});

test("application URLs fall back to the request origin in local development", () => {
  assert.equal(
    applicationUrl("/dashboard", "http://127.0.0.1:5181/login", {}).href,
    "http://127.0.0.1:5181/dashboard",
  );
});

test("public API links use the configured origin with a request-origin fallback", () => {
  const request = { url: "http://127.0.0.1:5181/api/v1/members/123" };
  assert.equal(
    publicApiOrigin(request, { ARCHERO_PUBLIC_ORIGIN: "https://archero.example.com" }),
    "https://archero.example.com",
  );
  assert.equal(publicApiOrigin(request, {}), "http://127.0.0.1:5181");
  assert.equal(
    absolutePublicUrl("/members/123", "https://archero.example.com"),
    "https://archero.example.com/members/123",
  );
});

test("only login, authentication assets, and health are public", () => {
  assert.equal(AUTH_COOKIE_NAME, "archero_session");
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/api/auth/login"), true);
  assert.equal(isPublicPath("/api/auth/logout"), true);
  assert.equal(isPublicPath("/api/health"), true);
  assert.equal(isPublicPath("/api/v1/health"), true);
  assert.equal(isPublicPath("/api/v1/members"), true);
  assert.equal(isPublicPath("/_next/static/app.js"), true);
  assert.equal(isPublicPath("/dashboard"), false);
  assert.equal(isPublicPath("/api/members"), false);
  assert.equal(isPublicPath("/admin/rules"), false);
});

test("admin pages and data mutation APIs require the admin role", () => {
  assert.equal(isAdminPath("/admin"), true);
  assert.equal(isAdminPath("/admin/rules"), true);
  assert.equal(isAdminPath("/api/data/import"), true);
  assert.equal(isAdminPath("/api/member-admin"), true);
  assert.equal(isAdminPath("/api/warning-actions"), true);
  assert.equal(isAdminPath("/dashboard"), false);
  assert.equal(isAdminPath("/api/dashboard-data"), false);
});

test("local OCR routes are identifiable without blocking remote ingestion", () => {
  assert.equal(isLocalOcrPath("/admin/data"), true);
  assert.equal(isLocalOcrPath("/api/data/import"), true);
  assert.equal(isLocalOcrPath("/admin/rules"), false);
  assert.equal(isLocalOcrPath("/api/v1/imports"), false);
  assert.equal(isLocalOcrPath("/api/v1/imports/validate"), false);
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
