import { validateImportBatch, MAX_IMPORT_BATCH_BYTES } from "../../../../../lib/import-batch.js";
import { readLimitedJson, RequestLimitError } from "../../../../../lib/request-security.js";
import { apiError, apiSuccess, requireIngestionKey } from "../../_lib/responses.js";

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

  const result = validateImportBatch(batch);
  if (!result.valid) {
    return apiError(422, "invalid_import_batch", result.errors.join("; "));
  }
  return apiSuccess({
    accepted: result.publishable,
    publishable: result.publishable,
    errors: result.errors,
    captureDate: batch.captureDate,
    idempotencyKey: batch.idempotencyKey,
    counts: {
      sourceImages: batch.sourceImages.length,
      members: batch.members.length,
      bossRankings: batch.bossRankings.length,
    },
  });
}
