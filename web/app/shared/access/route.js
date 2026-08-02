import { NextResponse } from "next/server";

import { applicationUrl } from "../../../lib/auth.js";
import { verifyMemberShareToken } from "../../../lib/share-links.js";

export function GET(request) {
  const token = request.nextUrl.searchParams.get("token");
  const grant = verifyMemberShareToken(token);
  if (!grant) return expiredResponse(request);

  const destination = applicationUrl(`/shared/members/${encodeURIComponent(grant.playerId)}?token=${encodeURIComponent(token)}`, request.url);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function expiredResponse(request) {
  const response = NextResponse.redirect(applicationUrl("/shared/expired", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
