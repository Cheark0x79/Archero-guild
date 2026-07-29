import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, ADMIN_ROLE, roleForSessionToken } from "../../../lib/auth.js";
import { projectRoot } from "../data/actions.js";
import { readWarningActions, saveWarningAction } from "../../../lib/warning-actions.js";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, actions: await readWarningActions(projectRoot()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "read failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  if (roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value) !== ADMIN_ROLE) {
    return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
  }
  try {
    const action = await saveWarningAction(projectRoot(), await request.json());
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "save failed" }, { status: 400 });
  }
}
