import { NextResponse } from "next/server";
import { readLimitedJson, RequestLimitError } from "../../../lib/request-security.js";

import { ADMIN_ROLE, AUTH_COOKIE_NAME, roleForSessionToken } from "../../../lib/auth.js";
import { hasDashboardActionHeader, runObserverModule } from "../data/actions.js";
import { invalidateDashboardDataCache } from "../dashboard-data/source.js";

function isAdmin(request) {
  return roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value) === ADMIN_ROLE;
}

export async function PUT(request) {
  if (!isAdmin(request)) return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
  if (!hasDashboardActionHeader(request)) return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  try {
    const payload = await readLimitedJson(request, 64 * 1024);
    const result = await runObserverModule("archero_guild.storage.guild_stats", ["--set-json", JSON.stringify(payload)]);
    if (!result.ok) {
      let error = "Unable to save snapshot; no changes were applied.";
      try { error = JSON.parse(result.stdout).error || error; } catch {}
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }
    invalidateDashboardDataCache();
    return NextResponse.json({ ok: true, snapshot: result.data?.snapshot });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "snapshot update failed" }, { status: error instanceof RequestLimitError ? error.status : 400 });
  }
}
