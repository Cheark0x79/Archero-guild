export const AUTH_COOKIE_NAME = "archero_admin_session";

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
