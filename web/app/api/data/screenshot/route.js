import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveScreenshotPath } from "../actions.js";

export async function GET(request) {
  const relativePath = request.nextUrl.searchParams.get("path");
  if (!relativePath) {
    return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
  }

  try {
    const absolutePath = resolveScreenshotPath(relativePath);
    const image = await fs.readFile(absolutePath);
    return new NextResponse(image, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "screenshot not found" }, { status: 404 });
  }
}
