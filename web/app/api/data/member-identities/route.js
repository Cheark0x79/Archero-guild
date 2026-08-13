import { NextResponse } from "next/server";

import { moveMemberAdminRecord } from "../../../../lib/member-admin.js";
import { hasDashboardActionHeader, projectRoot, runObserverModule } from "../actions.js";

export async function GET() {
  const result = await runObserverModule("archero_guild.storage.member_identities", ["list"]);
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
    if (payload?.action === "edit") {
      const currentPlayerId = typeof payload?.currentPlayerId === "string" ? payload.currentPlayerId.trim() : "";
      const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
      const observedName = typeof payload?.observedName === "string" ? payload.observedName.trim() : "";
      if (!/^\d{6,20}$/.test(currentPlayerId)) throw new Error("current player ID must contain 6 to 20 digits");
      if (!/^\d{6,20}$/.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
      if (!observedName || observedName.length > 120) throw new Error("observed name is required");
      const result = await runObserverModule(
        "archero_guild.storage.member_identities",
        ["edit", currentPlayerId, playerId, observedName],
      );
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "identity update failed" }, { status: result.status || 500 });
      }
      await moveMemberAdminRecord(projectRoot(), currentPlayerId, playerId);
      return NextResponse.json({ ok: true, member: result.data?.member });
    }
    if (payload?.action === "rename-unmatched") {
      const captureDate = typeof payload?.captureDate === "string" ? payload.captureDate.trim() : "";
      const source = typeof payload?.source === "string" ? payload.source.trim() : "";
      const observedName = typeof payload?.observedName === "string" ? payload.observedName.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(captureDate)) throw new Error("capture date must use YYYY-MM-DD");
      if (!source || source.length > 240) throw new Error("source is required");
      if (!observedName || observedName.length > 120) throw new Error("observed name is required");
      const result = await runObserverModule(
        "archero_guild.storage.member_identities",
        ["rename-unmatched", captureDate, source, observedName],
      );
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "OCR name correction failed" }, { status: result.status || 500 });
      }
      return NextResponse.json({ ok: true, member: result.data?.member });
    }
    if (payload?.action === "status") {
      const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
      const status = typeof payload?.status === "string" ? payload.status.trim() : "";
      const observedName = typeof payload?.observedName === "string" ? payload.observedName.trim() : "";
      if (!/^\d{6,20}$/.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
      if (!["active", "left", "kicked"].includes(status)) throw new Error("invalid member status");
      const result = await runObserverModule(
        "archero_guild.storage.member_identities",
        ["status", playerId, status, observedName],
      );
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "member status save failed" }, { status: result.status || 500 });
      }
      return NextResponse.json({ ok: true, member: result.data?.member });
    }
    if (payload?.action === "departure-review") {
      const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
      const decision = typeof payload?.decision === "string" ? payload.decision.trim() : "";
      const observedName = typeof payload?.observedName === "string" ? payload.observedName.trim() : "";
      if (!/^\d{6,20}$/.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
      if (!["confirm", "restore"].includes(decision)) throw new Error("invalid departure review decision");
      const result = await runObserverModule(
        "archero_guild.storage.member_identities",
        ["departure-review", playerId, decision, observedName],
      );
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "departure review save failed" }, { status: result.status || 500 });
      }
      return NextResponse.json({ ok: true, member: result.data?.member });
    }
    const observedName = typeof payload?.observedName === "string" ? payload.observedName.trim() : "";
    const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
    if (!observedName || observedName.length > 120) throw new Error("observed name is required");
    if (!/^\d{6,20}$/.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
    const result = await runObserverModule("archero_guild.storage.member_identities", ["assign", observedName, playerId]);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error || "identity save failed" }, { status: result.status || 500 });
    }
    return NextResponse.json({ ok: true, link: result.data?.link });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "identity save failed" }, { status: 400 });
  }
}
