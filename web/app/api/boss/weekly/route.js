import { NextResponse } from "next/server";
import { bossRankingsFromData, loadDashboardData } from "../../dashboard-data/source.js";

export async function GET() {
  const payload = await loadDashboardData();
  return NextResponse.json({
    ok: payload.ok,
    source: payload.source,
    warning: payload.warning,
    data: bossRankingsFromData(payload.data).weekly,
  });
}
