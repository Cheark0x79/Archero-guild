import { loadDashboardData } from "../../dashboard-data/source.js";
import { bossDaysFromData } from "../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../_lib/responses.js";

export async function GET(request) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const payload = await loadDashboardData();
  const result = bossDaysFromData(payload.data, request.nextUrl.searchParams);
  if (result.error) return apiError(400, result.error.code, result.error.message);
  return apiSuccess(result.items, payload);
}
