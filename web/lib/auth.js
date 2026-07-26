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
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/");
}

export function isAdminPath(pathname) {
  return pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === "/api/data"
    || pathname.startsWith("/api/data/");
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
