import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { hasDashboardActionHeader, resolveScreenshotPath } from "../actions.js";

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

  const relativePath = typeof payload.path === "string" ? payload.path : "";
  if (!relativePath) {
    return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
  }

  try {
    const absolutePath = resolveScreenshotPath(relativePath);
    await fs.unlink(absolutePath);
    return NextResponse.json({ ok: true, discarded: { path: relativePath } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "discard failed" }, { status: 500 });
  }
}
