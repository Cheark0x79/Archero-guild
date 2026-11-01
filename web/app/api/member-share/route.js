import { NextResponse } from "next/server";

import { ADMIN_ROLE, applicationUrl, AUTH_COOKIE_NAME, roleForSessionToken } from "../../../lib/auth.js";
import { createMemberShareCode, verifyMemberShareCode } from "../../../lib/share-links.js";
import { hasDashboardActionHeader } from "../data/actions.js";

import { loadDashboardData } from "../dashboard-data/source.js";
import { sharedMemberProfileFromData } from "../../../lib/shared-member.js";
import { shareImagePath } from "../../../lib/share-image.js";
import { checkApiRateLimit } from "../v1/_lib/rate-limit.js";

const SHARE_HOURS = 12;

export async function POST(request) {
  if (roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value) !== ADMIN_ROLE) {
    return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
  }
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 400 });
  }

  const budget = checkApiRateLimit(request, "share-create-global", { ARCHERO_API_RATE_LIMIT_PER_MINUTE: "10" });
  if (!budget.allowed) return NextResponse.json({ ok: false, error: "Too many shares. Try again later." }, { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds), "Cache-Control": "no-store" } });

  try {
    if (Number(request.headers.get("content-length")) > 1024) throw new Error("request too large");
    const reader = request.body?.getReader();
    const chunks = [];
    let length = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1024) { await reader.cancel(); throw new Error("request too large"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
    if (!/^\d{1,20}$/.test(playerId)) throw new Error("player ID is invalid");

    const data = await loadDashboardData({ bypassCache: true });
    if (!data.ok) return NextResponse.json({ ok: false, error: "Data unavailable" }, { status: 503 });
    const profile = sharedMemberProfileFromData(data.data, playerId);
    if (!profile) return NextResponse.json({ ok: false, error: "Member not found" }, { status: 404 });
    const code = createMemberShareCode(playerId, { expiresInHours: SHARE_HOURS });
    const grant = verifyMemberShareCode(code);
    return NextResponse.json({
      ok: true,
      url: applicationUrl(`/s/${code}`, request.url).href,
      expiresAt: grant.expiresAt.toISOString(),
      imageUrl: applicationUrl(shareImagePath(code, profile), request.url).href,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "share link creation failed" },
      { status: 400 },
    );
  }
}
