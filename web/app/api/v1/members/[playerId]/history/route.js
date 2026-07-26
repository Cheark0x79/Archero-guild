import { loadDashboardData } from "../../../../dashboard-data/source.js";
import { findMember, memberHistoryFromData, membersFromData } from "../../../_lib/domain.js";
import { apiError, apiSuccess, requireApiKey } from "../../../_lib/responses.js";

export async function GET(request, { params }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const { playerId } = await params;
  const payload = await loadDashboardData();
  if (!findMember(membersFromData(payload.data), playerId)) {
    return apiError(404, "member_not_found", "No member matches this player ID.");
  }
  const result = memberHistoryFromData(payload.data, playerId, request.nextUrl.searchParams);
  if (result.error) return apiError(400, result.error.code, result.error.message);
  return apiSuccess(result, payload);
}
