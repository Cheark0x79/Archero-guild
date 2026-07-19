import { NextResponse } from "next/server";
import { hasDashboardActionHeader } from "../actions.js";
import { startImportJob } from "./jobs.js";

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
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "date must use YYYY-MM-DD format" }, { status: 400 });
  }

  const result = startImportJob(date);
  return NextResponse.json({ ok: true, job: result.job, alreadyRunning: result.alreadyRunning }, { status: result.alreadyRunning ? 202 : 201 });
}
