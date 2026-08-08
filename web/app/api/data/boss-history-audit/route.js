import { NextResponse } from "next/server";

import { loadDashboardData } from "../../dashboard-data/source.js";
import { auditBossHistory } from "../../../../lib/boss-history-audit.js";

export async function GET() {
  const payload = await loadDashboardData({ bypassCache: true });
  return NextResponse.json({
    ok: true,
    dataAvailable: payload.ok,
    source: payload.source,
    dataMode: payload.dataMode,
    audit: auditBossHistory(payload.data),
  });
}
