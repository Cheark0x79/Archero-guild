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
      guildRoster: payload.data.guildRoster,
      memberSnapshots: payload.data.memberSnapshots,
      previousMemberSnapshots: payload.data.previousMemberSnapshots,
      dailyRawSnapshots: payload.data.dailyRawSnapshots,
      rules: payload.data.rules,
    },
  });
}
