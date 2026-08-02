import { loadDashboardData } from "../../dashboard-data/source.js";
import { membersFromData, queryMembers } from "../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../_lib/responses.js";
import { publicApiOrigin } from "../_lib/urls.js";

export async function GET(request) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const payload = await loadDashboardData();
  const result = queryMembers(membersFromData(payload.data, publicApiOrigin(request)), request.nextUrl.searchParams);
  if (result.error) return apiError(400, result.error.code, result.error.message);
  return apiSuccess(result.items, { ...payload, pagination: result.pagination });
}
