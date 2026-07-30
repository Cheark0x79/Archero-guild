import { loadDashboardData } from "../../dashboard-data/source.js";
import { violationsFromData } from "../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../_lib/responses.js";

export async function GET(request) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const payload = await loadDashboardData({ includeWarningActions: true });
  const result = violationsFromData(payload.data, request.nextUrl.searchParams);
  if (result.error) return apiError(result.error.status ?? 400, result.error.code, result.error.message);
  const response = apiSuccess({
    summary: result.summary,
    warningSummary: result.warningSummary,
    members: result.items,
    history: result.history,
    historyPagination: result.historyPagination,
  }, payload);
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/v1/warnings>; rel="successor-version"');
  return response;
}
