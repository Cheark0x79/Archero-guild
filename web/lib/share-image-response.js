import { loadDashboardData } from "../app/api/dashboard-data/source.js";
import { checkApiRateLimit } from "../app/api/v1/_lib/rate-limit.js";
import { verifyMemberShareCode } from "./share-links.js";
import { sharedMemberProfileFromData } from "./shared-member.js";
import { shareImageModel, shareImageVersion } from "./share-image.js";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const disposition = 'inline; filename="member-profile.png"';

// Guards and serves a member share PNG. `renderPng(model)` resolves to the
// PNG bytes; it is injected so the guards can be tested without Next.js.
export async function shareImageResponse(request, code, { renderPng, loadData = loadDashboardData }) {
  // Reject unsigned or expired codes before touching the budget, so junk
  // requests cannot exhaust it and block every legitimate share image.
  const grant = verifyMemberShareCode(code);
  const version = new URL(request.url).searchParams.get("version");
  if (!grant || !/^[a-f0-9]{64}$/.test(version ?? "")) return new Response("Share expired or invalid", { status: 410, headers });
  // A fixed global budget cannot be bypassed by forging proxy IP headers.
  // Bounds CPU and memory without an unbounded key map.
  const budget = checkApiRateLimit(request, "share-image-global", { ARCHERO_API_RATE_LIMIT_PER_MINUTE: "30" });
  if (!budget.allowed) return new Response("Try again later", { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
  if ((globalThis.__archeroShareImageActive ?? 0) >= 2) return new Response("Try again later", { status: 429, headers: { ...headers, "Retry-After": "1" } });
  globalThis.__archeroShareImageActive = (globalThis.__archeroShareImageActive ?? 0) + 1;
  try {
    const payload = await loadData({ bypassCache: true });
    if (!payload.ok) return new Response("Data unavailable", { status: 503, headers });
    const profile = sharedMemberProfileFromData(payload.data, grant.playerId);
    if (!profile) return new Response("Share expired or invalid", { status: 410, headers });
    const model = shareImageModel(profile);
    if (shareImageVersion(model) !== version) return new Response("Profile changed. Create a new image link.", { status: 410, headers });
    const png = await renderPng(model, { ...headers, "Content-Disposition": disposition });
    if (png.byteLength > 5 * 1024 * 1024) return new Response("Image too large", { status: 503, headers });
    return new Response(png, { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": disposition } });
  } catch {
    return new Response("Image unavailable", { status: 503, headers });
  } finally {
    globalThis.__archeroShareImageActive -= 1;
  }
}
