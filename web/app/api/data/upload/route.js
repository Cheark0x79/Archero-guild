import { NextResponse } from "next/server";
import {
  CAPTURE_KINDS,
  captureDateToday,
  hasDashboardActionHeader,
  nextUploadPath,
  relativeProjectPath,
  screenshotUrl,
  validateCaptureDate,
  writeUploadedPng,
} from "../actions.js";

export async function POST(request) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }

  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  const date = String(form.get("date") || captureDateToday());
  const file = form.get("file");

  if (!CAPTURE_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: `unknown capture kind: ${kind}` }, { status: 400 });
  }
  if (!validateCaptureDate(date)) {
    return NextResponse.json({ ok: false, error: "date must use YYYY-MM-DD format" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "PNG screenshot file is required" }, { status: 400 });
  }

  try {
    const destination = await nextUploadPath(kind, date);
    await writeUploadedPng(file, destination.absolutePath);
    const relativePath = relativeProjectPath(destination.absolutePath);
    return NextResponse.json({
      ok: true,
      upload: {
        path: relativePath,
        kind,
        date: destination.date,
        index: destination.index,
        imageUrl: screenshotUrl(relativePath),
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "upload failed" }, { status: 500 });
  }
}
