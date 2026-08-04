import { NextResponse } from "next/server";

import { applicationUrl } from "../../../lib/auth.js";
import { shareCookieName, verifyMemberShareCode } from "../../../lib/share-links.js";

export async function GET(request, context) {
  const { code } = await context.params;
  const grant = verifyMemberShareCode(code);
  if (!grant) return expiredResponse(request);

  const destination = applicationUrl(`/shared/members/${encodeURIComponent(grant.playerId)}`, request.url);
  const response = NextResponse.redirect(destination, 303);
  response.cookies.set({
    name: shareCookieName(grant.playerId),
    value: code,
    httpOnly: true,
    secure: destination.protocol === "https:",
    sameSite: "lax",
    path: `/shared/members/${encodeURIComponent(grant.playerId)}`,
    expires: grant.expiresAt,
  });
  setPrivateShareHeaders(response);
  return response;
}

function expiredResponse(request) {
  const response = NextResponse.redirect(applicationUrl("/shared/expired", request.url), 303);
  setPrivateShareHeaders(response);
  return response;
}

function setPrivateShareHeaders(response) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
}
