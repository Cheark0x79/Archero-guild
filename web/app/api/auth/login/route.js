import crypto from "node:crypto";
import { NextResponse } from "next/server";

const COOKIE_NAME = "archero_admin_session";

function equalSecret(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(request) {
  const password = process.env.ARCHERO_ADMIN_PASSWORD;
  const sessionToken = process.env.ARCHERO_ADMIN_SESSION_TOKEN;
  if (!password || !sessionToken) {
    return NextResponse.json(
      { ok: false, error: "admin authentication is not configured on this server" },
      { status: 503 },
    );
  }

  const payload = await request.json().catch(() => ({}));
  if (typeof payload.password !== "string" || !equalSecret(payload.password, password)) {
    return NextResponse.json({ ok: false, error: "invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
