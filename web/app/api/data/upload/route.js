import { NextResponse } from "next/server";
import { requireContentLength, RequestLimitError } from "../../../../lib/request-security.js";
import {
  CAPTURE_KINDS,
  MAX_UPLOAD_BYTES,
  captureDateToday,
  findExistingScreenshotByHash,
  hasDashboardActionHeader,
  nextUploadPath,
  readUploadedPng,
  relativeProjectPath,
  screenshotUrl,
  validateCaptureDate,
  writePngBuffer,
} from "../actions.js";

const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;

export async function POST(request) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }

  try {
    requireContentLength(request, MAX_MULTIPART_BYTES);
  } catch (error) {
    const status = error instanceof RequestLimitError ? error.status : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "invalid request size" }, { status });
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
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "PNG screenshot is too large" }, { status: 400 });
  }

  try {
    const upload = await readUploadedPng(file);
    const duplicate = await findExistingScreenshotByHash(kind, date, upload.sha256);
    if (duplicate) {
      const relativePath = relativeProjectPath(duplicate.absolutePath);
      return NextResponse.json({
        ok: true,
        duplicate: true,
        upload: {
          path: relativePath,
          kind,
          date: duplicate.date,
          index: duplicate.index,
          sha256: duplicate.sha256,
          imageUrl: screenshotUrl(relativePath),
        },
      });
    }

    let destination;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      destination = await nextUploadPath(kind, date);
      try {
        await writePngBuffer(upload.buffer, destination.absolutePath);
        break;
      } catch (error) {
        if (!(error && typeof error === "object" && error.code === "EEXIST") || attempt === 19) throw error;
      }
    }
    const relativePath = relativeProjectPath(destination.absolutePath);
    return NextResponse.json({
      ok: true,
      duplicate: false,
      upload: {
        path: relativePath,
        kind,
        date: destination.date,
        index: destination.index,
        sha256: upload.sha256,
        imageUrl: screenshotUrl(relativePath),
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "upload failed" }, { status: 500 });
  }
}
