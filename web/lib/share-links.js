import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_AUDIENCE = "archero-member-share";
const TOKEN_VERSION = 1;
export const DEFAULT_SHARE_HOURS = 24;
export const MAX_SHARE_HOURS = 24;

export function createMemberShareToken(playerId, options = {}) {
  const secret = shareSecret(options.environment);
  const now = options.now ?? new Date();
  const expiresInHours = normalizeShareHours(options.expiresInHours);
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    v: TOKEN_VERSION,
    aud: TOKEN_AUDIENCE,
    sub: cleanPlayerId(playerId),
    iat: issuedAt,
    exp: issuedAt + expiresInHours * 60 * 60,
    jti: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifyMemberShareToken(token, options = {}) {
  try {
    const secret = shareSecret(options.environment);
    const [encodedPayload, suppliedSignature, extra] = String(token ?? "").split(".");
    if (!encodedPayload || !suppliedSignature || extra) return null;
    const expectedSignature = signature(encodedPayload, secret);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
    if (payload?.v !== TOKEN_VERSION || payload?.aud !== TOKEN_AUDIENCE) return null;
    if (!payload.sub || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
    if (payload.exp <= nowSeconds || payload.iat > nowSeconds + 60) return null;
    return {
      playerId: cleanPlayerId(payload.sub),
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
      tokenId: payload.jti ?? null,
    };
  } catch {
    return null;
  }
}

export function shareCookieName(playerId) {
  return `archero_share_${cleanPlayerId(playerId)}`;
}

export function normalizeShareHours(value) {
  const hours = value == null ? DEFAULT_SHARE_HOURS : Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_SHARE_HOURS) {
    throw new Error(`expiresInHours must be an integer between 1 and ${MAX_SHARE_HOURS}`);
  }
  return hours;
}

function shareSecret(environment = process.env) {
  const secret = environment?.ARCHERO_SHARE_LINK_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("ARCHERO_SHARE_LINK_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function cleanPlayerId(value) {
  const playerId = String(value ?? "").trim();
  if (!/^\d{1,20}$/.test(playerId)) throw new Error("playerId is invalid");
  return playerId;
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
