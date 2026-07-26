import { timingSafeEqual } from "node:crypto";

export function authorizeApiRequest(request, configuredKeys = process.env.ARCHERO_API_KEYS) {
  const keys = String(configuredKeys ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (keys.length === 0) return { authorized: true, authentication: "disabled" };

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const candidate = bearer || request.headers.get("x-api-key")?.trim();
  if (!candidate) return { authorized: false, reason: "missing_api_key" };

  const authorized = keys.some((key) => safeEqual(candidate, key));
  return authorized
    ? { authorized: true, authentication: "api_key" }
    : { authorized: false, reason: "invalid_api_key" };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
