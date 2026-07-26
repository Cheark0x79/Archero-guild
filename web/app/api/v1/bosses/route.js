import { loadDashboardData } from "../../dashboard-data/source.js";
import { bossCatalogFromData } from "../_lib/domain.js";
import { apiSuccess, requireApiKey } from "../_lib/responses.js";

export async function GET(request) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;
  const payload = await loadDashboardData();
  return apiSuccess(bossCatalogFromData(payload.data), payload);
}
