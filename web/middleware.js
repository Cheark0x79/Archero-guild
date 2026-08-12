import { NextResponse } from "next/server";
import {
  applicationUrl,
  AUTH_COOKIE_NAME,
  isPublicPath,
  roleCanAccessPath,
  roleForSessionToken,
} from "./lib/auth.js";

export function middleware(request) {
  const role = roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const authenticated = Boolean(role);
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && authenticated) {
      return NextResponse.redirect(applicationUrl("/dashboard", request.url));
    }
    const response = NextResponse.next();
    if (pathname.startsWith("/shared/") || pathname.startsWith("/s/")) {
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return response;
  }

  if (authenticated && !roleCanAccessPath(pathname, role)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
    }
    return NextResponse.redirect(applicationUrl("/access-denied", request.url));
  }

  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const loginUrl = applicationUrl("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
