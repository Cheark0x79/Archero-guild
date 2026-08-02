import { latestDataDate } from "../../../../date.js";

export function apiLastImportDate(options = {}) {
  const data = options.data;
  if (!data || typeof data !== "object") return null;
  return latestDataDate({
    snapshotDates: [
      ...(data.dailyRawSnapshots ?? []).map((snapshot) => snapshot?.date),
      ...(data.dailyBossRawSnapshots ?? []).map((snapshot) => snapshot?.date),
    ],
    fallbacks: [data.captures?.lastImportedAt, data.captures?.lastCapturedAt],
  });
}
