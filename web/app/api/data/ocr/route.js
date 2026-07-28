import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

import { requireContentLength, RequestLimitError } from "../../../../lib/request-security.js";
import {
  CAPTURE_KINDS,
  MAX_UPLOAD_BYTES,
  hasDashboardActionHeader,
  readUploadedPng,
  runObserverModule,
} from "../actions.js";

const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;

export const maxDuration = 120;

export async function POST(request) {
  if (process.env.ARCHERO_OCR_LAB_ENABLED !== "1") {
    return NextResponse.json({ ok: false, error: "OCR Lab is only available on the local OCR machine" }, { status: 404 });
  }
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }
  try {
    requireContentLength(request, MAX_MULTIPART_BYTES);
  } catch (error) {
    const status = error instanceof RequestLimitError ? error.status : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "invalid request size" }, { status });
  }

  let temporaryDirectory;
  try {
    const form = await request.formData();
    const kind = String(form.get("kind") ?? "");
    const includePodium = String(form.get("includePodium") ?? "true") !== "false";
    const file = form.get("file");
    if (!CAPTURE_KINDS.has(kind)) {
      return NextResponse.json({ ok: false, error: `unknown OCR kind: ${kind}` }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "PNG screenshot file is required" }, { status: 400 });
    }

    const upload = await readUploadedPng(file);
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "archero-ocr-"));
    const inputPath = path.join(temporaryDirectory, "input.png");
    const normalizedPath = path.join(temporaryDirectory, "normalized.png");
    const annotatedPath = path.join(temporaryDirectory, "annotated.png");
    await fs.writeFile(inputPath, upload.buffer, { flag: "wx" });

    const argumentsList = [
      kind,
      inputPath,
      "--normalized",
      normalizedPath,
      "--annotated",
      annotatedPath,
    ];
    if (kind === "guild-boss" && !includePodium) argumentsList.push("--no-podium");
    const result = await runObserverModule("observer.ocr.service", argumentsList);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "OCR process failed" },
        { status: result.status || 500 },
      );
    }

    const [normalized, annotated] = await Promise.all([
      fs.readFile(normalizedPath),
      fs.readFile(annotatedPath),
    ]);
    return NextResponse.json({
      ok: true,
      sha256: upload.sha256,
      result: result.data,
      previews: {
        normalized: `data:image/png;base64,${normalized.toString("base64")}`,
        annotated: `data:image/png;base64,${annotated.toString("base64")}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "OCR request failed" },
      { status: 500 },
    );
  } finally {
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
