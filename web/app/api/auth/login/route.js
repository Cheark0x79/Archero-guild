import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ADMIN_ROLE, AUTH_COOKIE_NAME, USER_ROLE } from "../../../../lib/auth.js";
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
  const adminAccount = {
    username: process.env.ARCHERO_ADMIN_USERNAME || "admin",
    password: process.env.ARCHERO_ADMIN_PASSWORD,
    sessionToken: process.env.ARCHERO_ADMIN_SESSION_TOKEN,
    role: ADMIN_ROLE,
  };
  const userAccount = {
    username: process.env.ARCHERO_USER_USERNAME || "viewer",
    password: process.env.ARCHERO_USER_PASSWORD,
    sessionToken: process.env.ARCHERO_USER_SESSION_TOKEN,
    role: USER_ROLE,
  };
  const userAccountPartiallyConfigured = Boolean(userAccount.password) !== Boolean(userAccount.sessionToken);
  const sessionTokensConflict = Boolean(userAccount.sessionToken) && userAccount.sessionToken === adminAccount.sessionToken;
  const credentialsConflict = Boolean(userAccount.password)
    && userAccount.username === adminAccount.username
    && userAccount.password === adminAccount.password;
  if (!adminAccount.password || !adminAccount.sessionToken || userAccountPartiallyConfigured || sessionTokensConflict || credentialsConflict) {
    return NextResponse.json(
      { ok: false, error: "authentication is not configured on this server" },
      { status: 503 },
    );
  }
  const accounts = userAccount.password && userAccount.sessionToken
    ? [adminAccount, userAccount]
    : [adminAccount];

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

  const account = accounts.find((candidate) => {
    const usernameMatches = typeof payload.username === "string" && equalSecret(payload.username, candidate.username);
    const passwordMatches = typeof payload.password === "string" && equalSecret(payload.password, candidate.password);
    return usernameMatches && passwordMatches;
  });
  if (!account) {
    loginLimiter.recordFailure(clientAddress);
    console.warn("Rejected login attempt.", { clientAddress });
    return NextResponse.json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }

  loginLimiter.clear(clientAddress);
  const response = NextResponse.json({ ok: true, role: account.role });
  response.cookies.set(AUTH_COOKIE_NAME, account.sessionToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
