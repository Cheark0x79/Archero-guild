import { NextResponse } from "next/server";
import { ADMIN_ROLE, AUTH_COOKIE_NAME, roleForSessionToken } from "../../../lib/auth.js";
import { loadDashboardData } from "./source.js";

export async function GET(request) {
  try {
    const role = roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
    return NextResponse.json(await loadDashboardData({ includeWarningActions: role === ADMIN_ROLE }));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: "database",
        error: error instanceof Error ? error.message : "Database unavailable.",
      },
      { status: 503 },
    );
  }
}
