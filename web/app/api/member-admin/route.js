import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, ADMIN_ROLE, roleForSessionToken } from "../../../lib/auth.js";
import { readMemberAdminRecords, saveMemberAdminRecord } from "../../../lib/member-admin.js";
import { hasDashboardActionHeader, projectRoot } from "../data/actions.js";

function isAdmin(request) {
  return roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value) === ADMIN_ROLE;
}

export async function GET(request) {
  if (!isAdmin(request)) {
    return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, records: await readMemberAdminRecords(projectRoot()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "read failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  if (!isAdmin(request)) {
    return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
  }
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 400 });
  }
  try {
    const payload = await request.json();
    const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
    const record = await saveMemberAdminRecord(projectRoot(), playerId, payload?.record);
    return NextResponse.json({ ok: true, playerId, record });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "save failed" }, { status: 400 });
  }
}
