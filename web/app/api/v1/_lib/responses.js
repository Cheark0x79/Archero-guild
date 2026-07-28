import { NextResponse } from "next/server";
import { authorizeApiRequest } from "./auth.js";
import { checkApiRateLimit } from "./rate-limit.js";

export function requireApiKey(request) {
  const auth = authorizeApiRequest(request);
  if (!auth.authorized) {
    if (auth.reason === "api_not_configured") {
      return apiError(503, auth.reason, "API authentication is not configured on this server.");
    }
    return apiError(401, auth.reason, "A valid API key is required.", {
      "WWW-Authenticate": 'Bearer realm="archero-api"',
    });
  }
  const rateLimit = checkApiRateLimit(request, auth.principal);
  if (!rateLimit.allowed) {
    return apiError(429, "rate_limited", "API rate limit exceeded.", {
      "Retry-After": String(rateLimit.retryAfterSeconds),
      "X-RateLimit-Limit": String(rateLimit.limit),
      "X-RateLimit-Remaining": "0",
    });
  }
  return null;
}

export function apiSuccess(data, options = {}) {
  return NextResponse.json(
    {
      data,
      meta: {
        apiVersion: "v1",
        generatedAt: new Date().toISOString(),
        ...(options.source ? { source: options.source } : {}),
        ...(options.dataMode ? { dataMode: options.dataMode } : {}),
        ...(typeof options.partial === "boolean" ? { partial: options.partial } : {}),
        ...(options.missingDomains?.length ? { missingDomains: options.missingDomains } : {}),
        ...(options.warning ? { warning: options.warning } : {}),
        ...(options.pagination ? { pagination: options.pagination } : {}),
      },
    },
    { status: options.status ?? 200, headers: { "Cache-Control": options.cacheControl ?? "no-store" } },
  );
}

export function apiError(status, code, message, headers = {}) {
  return NextResponse.json(
    {
      error: { code, message },
      meta: { apiVersion: "v1", generatedAt: new Date().toISOString() },
    },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}
