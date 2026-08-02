import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runObserverModule } from "../../data/actions.js";
import { validateImportBatch, MAX_IMPORT_BATCH_BYTES } from "../../../../lib/import-batch.js";
import { readLimitedJson, RequestLimitError } from "../../../../lib/request-security.js";
import { apiError, apiSuccess, requireIngestionKey } from "../_lib/responses.js";

export const maxDuration = 60;

export async function POST(request) {
  const unauthorized = requireIngestionKey(request);
  if (unauthorized) return unauthorized;

  let batch;
  try {
    batch = await readLimitedJson(request, MAX_IMPORT_BATCH_BYTES);
  } catch (error) {
    if (error instanceof RequestLimitError) {
      return apiError(error.status, "request_too_large", error.message);
    }
    return apiError(400, "invalid_json", "The request body must contain valid JSON.");
  }

  const validation = validateImportBatch(batch, { requirePublishable: true });
  if (!validation.valid) {
    return apiError(422, "invalid_import_batch", validation.errors.join("; "));
  }

  let temporaryDirectory;
  try {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "archero-import-"));
    const batchPath = path.join(temporaryDirectory, "batch.json");
    await fs.writeFile(batchPath, JSON.stringify(batch), { encoding: "utf8", flag: "wx" });
    const result = await runObserverModule("observer.storage.ingest_batch", [batchPath]);
    if (!result.ok) {
      return apiError(result.status || 500, "import_failed", result.error || "The import failed.");
    }
    return apiSuccess(result.data, {
      status: result.data.replayed ? 200 : 201,
      importDate: result.data.result?.captureDate ?? batch.captureDate,
    });
  } finally {
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
