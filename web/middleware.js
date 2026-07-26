import { NextResponse } from "next/server";

const COOKIE_NAME = "archero_admin_session";

function isProtected(request) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/admin")) return true;
  if (["/api/data/reviews", "/api/data/rules"].includes(pathname) && request.method === "GET") return false;
  return pathname.startsWith("/api/data/");
}

export function middleware(request) {
  if (!isProtected(request)) return NextResponse.next();

  const sessionToken = process.env.ARCHERO_ADMIN_SESSION_TOKEN;
  const localDevelopment = process.env.NODE_ENV !== "production" && !sessionToken;
  if (localDevelopment) return NextResponse.next();

  const authenticated = Boolean(sessionToken) && request.cookies.get(COOKIE_NAME)?.value === sessionToken;
  if (authenticated) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "admin authentication required" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/data/:path*"],
};
