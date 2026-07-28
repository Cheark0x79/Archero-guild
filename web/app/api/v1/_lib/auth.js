import { createHash, timingSafeEqual } from "node:crypto";

export function authorizeApiRequest(request, configuredKeys = process.env.ARCHERO_API_KEYS, environment = process.env) {
  const keys = String(configuredKeys ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    return environment.NODE_ENV === "production"
      ? { authorized: false, reason: "api_not_configured" }
      : { authorized: true, authentication: "disabled", principal: "development" };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const candidate = bearer || request.headers.get("x-api-key")?.trim();
  if (!candidate) return { authorized: false, reason: "missing_api_key" };

  const authorized = keys.some((key) => safeEqual(candidate, key));
  return authorized
    ? { authorized: true, authentication: "api_key", principal: keyFingerprint(candidate) }
    : { authorized: false, reason: "invalid_api_key" };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function keyFingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
