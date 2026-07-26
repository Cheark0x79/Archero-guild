import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "../../../../lib/auth.js";
import {
  createFailureRateLimiter,
  readLimitedJson,
  requestClientAddress,
  RequestLimitError,
} from "../../../../lib/request-security.js";

const loginLimiter = createFailureRateLimiter();

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

  const clientAddress = requestClientAddress(request);
  const limit = loginLimiter.check(clientAddress);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "too many login attempts; try again later" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    loginLimiter.recordFailure(clientAddress);
    return NextResponse.json({ ok: false, error: "application/json is required" }, { status: 415 });
  }

  let payload;
  try {
    payload = await readLimitedJson(request);
  } catch (error) {
    loginLimiter.recordFailure(clientAddress);
    const status = error instanceof RequestLimitError ? error.status : 400;
    return NextResponse.json({ ok: false, error: status === 413 ? "request body is too large" : "invalid JSON body" }, { status });
  }

  if (typeof payload.password !== "string" || !equalSecret(payload.password, password)) {
    loginLimiter.recordFailure(clientAddress);
    console.warn("Rejected login attempt.", { clientAddress });
    return NextResponse.json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }

  loginLimiter.clear(clientAddress);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
