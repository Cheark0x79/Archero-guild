const WINDOW_MS = 60_000;

export function checkApiRateLimit(
  request,
  principal,
  environment = process.env,
  now = Date.now(),
) {
  const limit = configuredLimit(environment.ARCHERO_API_RATE_LIMIT_PER_MINUTE);
  if (limit === 0) return { allowed: true, limit: 0, remaining: null, retryAfterSeconds: 0 };

  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const key = principal || clientAddress(request);
  const buckets = rateLimitBuckets();
  const current = buckets.get(key);
  const bucket = current?.windowStart === windowStart
    ? current
    : { windowStart, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  pruneBuckets(buckets, windowStart);

  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000)),
  };
}

export function resetApiRateLimitForTest() {
  rateLimitBuckets().clear();
}

function configuredLimit(value) {
  if (value == null || value === "") return 120;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 120;
  return Math.min(parsed, 100_000);
}

function clientAddress(request) {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function rateLimitBuckets() {
  if (!globalThis.__archeroApiRateLimitBuckets) {
    globalThis.__archeroApiRateLimitBuckets = new Map();
  }
  return globalThis.__archeroApiRateLimitBuckets;
}

function pruneBuckets(buckets, windowStart) {
  if (buckets.size < 1_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < windowStart) buckets.delete(key);
  }
}
