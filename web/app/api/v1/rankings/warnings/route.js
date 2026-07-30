import { loadDashboardData } from "../../../dashboard-data/source.js";
import { warningRankingsFromData } from "../../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../../_lib/responses.js";

export async function GET(request) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const payload = await loadDashboardData({ includeWarningActions: true });
  const result = warningRankingsFromData(payload.data, request.nextUrl.searchParams);
  if (result.error) return apiError(result.error.status ?? 400, result.error.code, result.error.message);
  return apiSuccess(result, payload);
}
