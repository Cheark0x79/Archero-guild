import { NextResponse } from "next/server";
import { authorizeApiRequest } from "./auth.js";

export function requireApiKey(request) {
  const auth = authorizeApiRequest(request);
  if (auth.authorized) return null;
  return apiError(401, auth.reason, "A valid API key is required.", {
    "WWW-Authenticate": 'Bearer realm="archero-api"',
  });
}

export function requireIngestionKey(request) {
  const configuredKeys = process.env.ARCHERO_INGESTION_KEYS;
  if (!String(configuredKeys ?? "").trim()) {
    return apiError(503, "ingestion_disabled", "Remote OCR ingestion is not configured.");
  }
  const auth = authorizeApiRequest(request, configuredKeys);
  if (auth.authorized) return null;
  return apiError(401, auth.reason, "A valid ingestion key is required.", {
    "WWW-Authenticate": 'Bearer realm="archero-ingestion"',
  });
}

export function apiSuccess(data, options = {}) {
  return NextResponse.json(
    {
      data,
      meta: {
        apiVersion: "v1",
        generatedAt: new Date().toISOString(),
        ...(options.source ? { source: options.source } : {}),
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
