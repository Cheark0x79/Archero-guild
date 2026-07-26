import { loadDashboardData } from "../../../../dashboard-data/source.js";
import { bossRankings } from "../../../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../../../_lib/responses.js";

export async function GET(request, { params }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { ranking } = await params;
  const payload = await loadDashboardData();
  const result = bossRankings(payload.data, ranking, request.nextUrl.searchParams);
  if (result.error) return apiError(400, result.error.code, result.error.message);
  return apiSuccess(result.items, payload);
}
