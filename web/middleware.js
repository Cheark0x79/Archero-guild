import { NextResponse } from "next/server";
import { ADMIN_ROLE, AUTH_COOKIE_NAME, isAdminPath, isPublicPath, roleForSessionToken } from "./lib/auth.js";

export function middleware(request) {
  const role = roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const authenticated = Boolean(role);
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && authenticated) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  if (authenticated && isAdminPath(pathname) && role !== ADMIN_ROLE) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
