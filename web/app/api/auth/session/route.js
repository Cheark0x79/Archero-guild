import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, roleForSessionToken } from "../../../../lib/auth.js";

export async function GET(request) {
  const role = roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!role) {
    return NextResponse.json({ ok: false, error: "authentication required" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, role });
}
