import { NextResponse } from "next/server";
import { hasDashboardActionHeader, runObserverModule } from "../actions.js";

export async function POST(request) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const date = typeof payload.date === "string" && payload.date.trim() ? payload.date.trim() : null;
  const result = await runObserverModule("observer.import_capture", date ? [date] : []);
  return NextResponse.json(result.ok ? { ok: true, import: result.data } : { ok: false, error: result.error }, { status: result.status });
}
