import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { hasDashboardActionHeader, projectRoot, relativeProjectPath, resolveScreenshotPath } from "../actions.js";

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
    const trashRoot = path.join(projectRoot(), "screenshots", "trash");
    const relativeFromRaw = path.relative(path.join(projectRoot(), "screenshots", "raw"), absolutePath);
    const trashPath = path.join(trashRoot, relativeFromRaw);
    await fs.mkdir(path.dirname(trashPath), { recursive: true });
    let recoverablePath = trashPath;
    try {
      await fs.rename(absolutePath, recoverablePath);
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
      const parsed = path.parse(trashPath);
      recoverablePath = path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
      await fs.rename(absolutePath, recoverablePath);
    }
    return NextResponse.json({
      ok: true,
      discarded: { path: relativePath, recoverablePath: relativeProjectPath(recoverablePath) },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "discard failed" }, { status: 500 });
  }
}
