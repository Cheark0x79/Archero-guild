import { loadDashboardData } from "../../../dashboard-data/source.js";
import { resolveMemberFromData } from "../../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../../_lib/responses.js";
import { publicApiOrigin } from "../../_lib/urls.js";

export async function GET(request) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const payload = await loadDashboardData();
  const result = resolveMemberFromData(payload.data, request.nextUrl.searchParams, publicApiOrigin(request));
  if (result.error) return apiError(400, result.error.code, result.error.message);
  return apiSuccess(result, payload);
}
