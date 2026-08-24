import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ROLE,
  ADMIN_ACCESS,
  accessLevelForPath,
  AUTHENTICATED_ACCESS,
  applicationUrl,
  AUTH_COOKIE_NAME,
  isAdminPath,
  isPublicPath,
  roleForSessionToken,
  roleCanAccessPath,
  USER_ROLE,
} from "../lib/auth.js";
import { navigationItemsForRole, sessionRoleLabel } from "../lib/navigation.js";
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
  assert.equal(isPublicPath("/s/short-code"), true);
  assert.equal(isPublicPath("/s"), false);
  assert.equal(isPublicPath("/shared/expired"), true);
  assert.equal(isPublicPath("/shared/members/900000104"), true);
  assert.equal(isPublicPath("/bosses/flame-demon.png"), true);
  assert.equal(isPublicPath("/_next/static/app.js"), true);
  assert.equal(isPublicPath("/dashboard"), false);
  assert.equal(isPublicPath("/api/members"), false);
  assert.equal(isPublicPath("/admin/rules"), false);
});

test("admin pages and data mutation APIs require the admin role", () => {
  assert.equal(isAdminPath("/admin"), true);
  assert.equal(isAdminPath("/admin/membership"), true);
  assert.equal(isAdminPath("/admin/notifications"), true);
  assert.equal(isAdminPath("/admin/members"), true);
  assert.equal(isAdminPath("/admin/rules"), true);
  assert.equal(isAdminPath("/activity"), true);
  assert.equal(isAdminPath("/admin/activity"), true);
  assert.equal(isAdminPath("/test"), true);
  assert.equal(isAdminPath("/api/member-admin"), true);
  assert.equal(isAdminPath("/api/member-share"), true);
  assert.equal(isAdminPath("/api/warning-actions"), true);
  assert.equal(isAdminPath("/dashboard"), false);
  assert.equal(isAdminPath("/api/dashboard-data"), false);
});

test("the route access matrix distinguishes public, viewer, and admin paths", () => {
  assert.equal(accessLevelForPath("/api/health"), "public");
  assert.equal(accessLevelForPath("/members"), AUTHENTICATED_ACCESS);
  assert.equal(accessLevelForPath("/admin"), ADMIN_ACCESS);
  assert.equal(roleCanAccessPath("/members", USER_ROLE), true);
  assert.equal(roleCanAccessPath("/admin", USER_ROLE), false);
  assert.equal(roleCanAccessPath("/admin/membership", USER_ROLE), false);
  assert.equal(roleCanAccessPath("/admin/members", USER_ROLE), false);
  assert.equal(roleCanAccessPath("/test", USER_ROLE), false);
  assert.equal(roleCanAccessPath("/api/member-admin", USER_ROLE), false);
  assert.equal(roleCanAccessPath("/api/member-share", USER_ROLE), false);
  assert.equal(roleCanAccessPath("/admin/rules", ADMIN_ROLE), true);
  assert.equal(roleCanAccessPath("/admin/membership", ADMIN_ROLE), true);
  assert.equal(roleCanAccessPath("/dashboard", null), false);
});

test("viewer navigation excludes every admin page while admin navigation is explicit", () => {
  const viewerNavigation = navigationItemsForRole(USER_ROLE);
  assert.deepEqual(viewerNavigation.admin, []);
  assert.deepEqual(viewerNavigation.test, []);
  assert.equal(viewerNavigation.primary.some((item) => item[2].startsWith("/admin")), false);
  assert.deepEqual(viewerNavigation.primary.map((item) => item[2]), ["/dashboard", "/members", "/boss"]);
  assert.equal(sessionRoleLabel(USER_ROLE), "Viewer");

  const platformAdminNavigation = navigationItemsForRole(ADMIN_ROLE);
  assert.deepEqual(platformAdminNavigation.admin.map((item) => item[2]), ["/admin", "/admin/members", "/admin/member-history", "/admin/notifications", "/admin/rules", "/api-docs"]);
  assert.deepEqual(platformAdminNavigation.test, []);
    const testAdminNavigation = navigationItemsForRole(ADMIN_ROLE, { testToolsEnabled: true });
    assert.deepEqual(testAdminNavigation.test.map((item) => item[2]), ["/test"]);
    assert.equal(sessionRoleLabel(ADMIN_ROLE), "Administrator");
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
