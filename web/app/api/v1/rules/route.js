import { loadDashboardData } from "../../dashboard-data/source.js";
import { rulesFromData } from "../_lib/domain.js";
import { apiSuccess, requireApiKey } from "../_lib/responses.js";

export async function GET(request) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const payload = await loadDashboardData();
  return apiSuccess(rulesFromData(payload.data), payload);
}
