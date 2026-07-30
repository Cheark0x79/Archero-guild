import { NextResponse } from "next/server";
import { loadDashboardData } from "../dashboard-data/source.js";

export async function GET() {
  const payload = await loadDashboardData();
  return NextResponse.json({
    ok: payload.ok,
    source: payload.source,
    dataMode: payload.dataMode,
    partial: payload.partial,
    missingDomains: payload.missingDomains,
    warning: payload.warning,
    data: {
      captures: payload.data.captures,
      changes: payload.data.changes,
      guildRoster: payload.data.guildRoster,
      memberSnapshots: payload.data.memberSnapshots,
      dailyRawSnapshots: payload.data.dailyRawSnapshots,
      dailyBossRawSnapshots: payload.data.dailyBossRawSnapshots,
      rules: payload.data.rules,
    },
  });
}
