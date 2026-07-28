import { NextResponse } from "next/server";

import { hasDashboardActionHeader, runObserverModule } from "../actions.js";

export async function GET() {
  const result = await runObserverModule("observer.storage.member_identities", ["list"]);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error || "identity read failed" }, { status: result.status || 500 });
  }
  return NextResponse.json({ ok: true, links: result.data?.links ?? [] });
}

export async function POST(request) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 400 });
  }
  try {
    const payload = await request.json();
    if (payload?.action === "status") {
      const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
      const status = typeof payload?.status === "string" ? payload.status.trim() : "";
      const observedName = typeof payload?.observedName === "string" ? payload.observedName.trim() : "";
      if (!/^\d{6,20}$/.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
      if (!["active", "left", "kicked"].includes(status)) throw new Error("invalid member status");
      const result = await runObserverModule(
        "observer.storage.member_identities",
        ["status", playerId, status, observedName],
      );
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "member status save failed" }, { status: result.status || 500 });
      }
      return NextResponse.json({ ok: true, member: result.data?.member });
    }
    const observedName = typeof payload?.observedName === "string" ? payload.observedName.trim() : "";
    const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
    if (!observedName || observedName.length > 120) throw new Error("observed name is required");
    if (!/^\d{6,20}$/.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
    const result = await runObserverModule("observer.storage.member_identities", ["assign", observedName, playerId]);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error || "identity save failed" }, { status: result.status || 500 });
    }
    return NextResponse.json({ ok: true, link: result.data?.link });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "identity save failed" }, { status: 400 });
  }
}
