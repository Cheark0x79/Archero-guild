import { NextResponse } from "next/server";

import { ADMIN_ROLE, applicationUrl, AUTH_COOKIE_NAME, roleForSessionToken } from "../../../lib/auth.js";
import { createMemberShareCode, verifyMemberShareCode } from "../../../lib/share-links.js";
import { hasDashboardActionHeader } from "../data/actions.js";

const SHARE_HOURS = 12;

export async function POST(request) {
  if (roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value) !== ADMIN_ROLE) {
    return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
  }
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 400 });
  }

  try {
    const payload = await request.json();
    const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
    if (!/^\d{1,20}$/.test(playerId)) throw new Error("player ID is invalid");

    const code = createMemberShareCode(playerId, { expiresInHours: SHARE_HOURS });
    const grant = verifyMemberShareCode(code);
    return NextResponse.json({
      ok: true,
      url: applicationUrl(`/s/${code}`, request.url).href,
      expiresAt: grant.expiresAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "share link creation failed" },
      { status: 400 },
    );
  }
}
