import { ImageResponse } from "next/og";
import { loadDashboardData } from "../../../api/dashboard-data/source.js";
import { checkApiRateLimit } from "../../../api/v1/_lib/rate-limit.js";
import { verifyMemberShareCode } from "../../../../lib/share-links.js";
import { sharedMemberProfileFromData } from "../../../../lib/shared-member.js";
import { shareImageModel, shareImageVersion } from "../../../../lib/share-image.js";
import { renderShareImage } from "../../../../lib/share-image-render.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request, context) {
  // A fixed global budget cannot be bypassed by forging proxy IP headers or
  // enumerating codes. Bounds CPU and memory without an unbounded key map.
  const budget = checkApiRateLimit(request, "share-image-global", { ARCHERO_API_RATE_LIMIT_PER_MINUTE: "30" });
  if (!budget.allowed) return new Response("Try again later", { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
  const { code } = await context.params;
  const grant = verifyMemberShareCode(code);
  const version = new URL(request.url).searchParams.get("version");
  if (!grant || !/^[a-f0-9]{64}$/.test(version ?? "")) return new Response("Share expired or invalid", { status: 410, headers });
  if ((globalThis.__archeroShareImageActive ?? 0) >= 2) return new Response("Try again later", { status: 429, headers: { ...headers, "Retry-After": "1" } });
  globalThis.__archeroShareImageActive = (globalThis.__archeroShareImageActive ?? 0) + 1;
  try {
    const payload = await loadDashboardData({ bypassCache: true });
    if (!payload.ok) return new Response("Data unavailable", { status: 503, headers });
    const profile = sharedMemberProfileFromData(payload.data, grant.playerId);
    if (!profile) return new Response("Share expired or invalid", { status: 410, headers });
    const model = shareImageModel(profile);
    if (shareImageVersion(model) !== version) return new Response("Profile changed. Create a new image link.", { status: 410, headers });
    const image = new ImageResponse(renderShareImage(model), {
      width: 1200, height: 900,
      headers: { ...headers, "Content-Disposition": 'inline; filename="member-profile.png"' },
    });
    const png = await image.arrayBuffer();
    if (png.byteLength > 5 * 1024 * 1024) return new Response("Image too large", { status: 503, headers });
    return new Response(png, { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": 'inline; filename="member-profile.png"' } });
  } catch {
    return new Response("Image unavailable", { status: 503, headers });
  } finally {
    globalThis.__archeroShareImageActive -= 1;
  }
}
