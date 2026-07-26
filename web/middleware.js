import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isPublicPath } from "./lib/auth.js";

export function middleware(request) {
  const sessionToken = process.env.ARCHERO_ADMIN_SESSION_TOKEN;
  const authenticated = Boolean(sessionToken) && request.cookies.get(AUTH_COOKIE_NAME)?.value === sessionToken;
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && authenticated) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
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
