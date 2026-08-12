import { runObserverModule } from "../../../data/actions.js";
import { apiError, apiSuccess, requireIngestionKey } from "../../_lib/responses.js";

export async function GET(request) {
  const unauthorized = requireIngestionKey(request);
  if (unauthorized) return unauthorized;

  const rawLimit = new URL(request.url).searchParams.get("limit") ?? "10";
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) {
    return apiError(400, "invalid_limit", "limit must be an integer between 1 and 50.");
  }
  const result = await runObserverModule("archero_guild.storage.import_history", ["--limit", rawLimit]);
  if (!result.ok) {
    return apiError(result.status || 500, "history_unavailable", result.error || "Import history is unavailable.");
  }
  return apiSuccess(result.data, { source: "database" });
}
