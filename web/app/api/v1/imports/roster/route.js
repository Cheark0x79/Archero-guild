import { loadDashboardData } from "../../../dashboard-data/source.js";
import { membersFromData } from "../../_lib/domain.js";
import { apiSuccess, requireIngestionKey } from "../../_lib/responses.js";

const FORMER_STATUSES = new Set(["inactive", "left", "kicked"]);

export async function GET(request) {
  const unauthorized = requireIngestionKey(request);
  if (unauthorized) return unauthorized;

  const payload = await loadDashboardData();
  const roster = membersFromData(payload.data)
    .filter((member) => member.playerId && !FORMER_STATUSES.has(member.guildStatus))
    .map((member) => ({
      playerId: member.playerId,
      name: member.name,
      power: member.metrics?.power ?? null,
    }));

  return apiSuccess(roster, { source: payload.source });
}
