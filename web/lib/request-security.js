export const LOGIN_BODY_LIMIT = 4 * 1024;
export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export class RequestLimitError extends Error {
  constructor(message, status = 413) {
    super(message);
    this.name = "RequestLimitError";
    this.status = status;
  }
}

export async function readLimitedJson(request, maximumBytes = LOGIN_BODY_LIMIT) {
  const declaredLength = parseContentLength(request.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > maximumBytes) {
    throw new RequestLimitError("request body is too large");
  }

  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RequestLimitError("request body is too large");
    }
    chunks.push(value);
  }

  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  return body ? JSON.parse(body) : {};
}

export function requireContentLength(request, maximumBytes) {
  const declaredLength = parseContentLength(request.headers.get("content-length"));
  if (declaredLength === null) throw new RequestLimitError("content-length is required", 411);
  if (declaredLength > maximumBytes) throw new RequestLimitError("request body is too large");
  return declaredLength;
}

export function requestClientAddress(request) {
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareAddress) return cloudflareAddress.slice(0, 128);
  const forwardedAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwardedAddress || "unknown").slice(0, 128);
}

export function createFailureRateLimiter({ maximumAttempts = LOGIN_ATTEMPT_LIMIT, windowMs = LOGIN_WINDOW_MS } = {}) {
  const failures = new Map();

  function currentEntry(key, now) {
    const entry = failures.get(key);
    if (!entry || now - entry.startedAt >= windowMs) {
      failures.delete(key);
      return null;
    }
    return entry;
  }

  return {
    check(key, now = Date.now()) {
      const entry = currentEntry(key, now);
      if (!entry || entry.count < maximumAttempts) return { allowed: true, remaining: maximumAttempts - (entry?.count ?? 0) };
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + windowMs - now) / 1000)),
      };
    },
    recordFailure(key, now = Date.now()) {
      if (failures.size >= 5000) {
        for (const [storedKey, storedEntry] of failures) {
          if (now - storedEntry.startedAt >= windowMs) failures.delete(storedKey);
        }
        if (failures.size >= 5000) failures.delete(failures.keys().next().value);
      }
      const entry = currentEntry(key, now);
      failures.set(key, entry ? { ...entry, count: entry.count + 1 } : { count: 1, startedAt: now });
      return this.check(key, now);
    },
    clear(key) {
      failures.delete(key);
    },
  };
}

function parseContentLength(value) {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new RequestLimitError("invalid content-length", 400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RequestLimitError("invalid content-length", 400);
  return parsed;
}
