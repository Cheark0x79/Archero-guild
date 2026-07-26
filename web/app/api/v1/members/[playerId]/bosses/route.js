import { loadDashboardData } from "../../../../dashboard-data/source.js";
import { memberBossesFromData } from "../../../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../../../_lib/responses.js";

export async function GET(request, { params }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const { playerId } = await params;
  const payload = await loadDashboardData();
  const result = memberBossesFromData(payload.data, decodeURIComponent(playerId));
  if (!result) return apiError(404, "member_not_found", "No member matches this player ID.");
  return apiSuccess(result, payload);
}
