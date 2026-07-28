import { NextResponse } from "next/server";
import { loadDashboardData } from "./source.js";

export async function GET() {
  return NextResponse.json(await loadDashboardData({ bypassCache: true }));
}
