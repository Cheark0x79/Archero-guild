export const AUTH_COOKIE_NAME = "archero_session";
export const USER_ROLE = "user";
export const ADMIN_ROLE = "admin";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

export function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname)
    || pathname.startsWith("/_next/")
    || pathname.startsWith("/s/")
    || pathname === "/shared/expired"
    || pathname.startsWith("/shared/members/")
    || pathname.startsWith("/bosses/")
    || pathname === "/api/v1"
    || pathname.startsWith("/api/v1/");
}

export function isAdminPath(pathname) {
  return pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === "/api/member-admin"
    || pathname === "/api/warning-actions"
    || pathname === "/api/data"
    || pathname.startsWith("/api/data/");
}

export function isLocalOcrPath(pathname) {
  return pathname === "/admin/data"
    || pathname.startsWith("/api/data/capture/")
    || pathname === "/api/data/discard"
    || pathname === "/api/data/import"
    || pathname === "/api/data/import/status"
    || pathname === "/api/data/screenshot";
}

export function applicationUrl(pathname, requestUrl, environment = process.env) {
  const configuredOrigin = environment.ARCHERO_PUBLIC_ORIGIN?.trim();
  if (!configuredOrigin) return new URL(pathname, requestUrl);

  const publicUrl = new URL(configuredOrigin);
  if (!["http:", "https:"].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password) {
    throw new Error("ARCHERO_PUBLIC_ORIGIN must be an HTTP(S) origin without credentials");
  }
  return new URL(pathname, publicUrl.origin);
}

export function roleForSessionToken(token, environment = process.env) {
  if (!token) return null;
  const adminToken = environment.ARCHERO_ADMIN_SESSION_TOKEN;
  const userToken = environment.ARCHERO_USER_SESSION_TOKEN;
  if (adminToken && userToken && adminToken === userToken) return null;
  if (adminToken && token === adminToken) {
    return ADMIN_ROLE;
  }
  if (userToken && token === userToken) {
    return USER_ROLE;
  }
  return null;
}
