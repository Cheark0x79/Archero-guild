import { latestDataDate } from "../../../../date.js";

export function apiLastImportDate(options = {}) {
  const data = options.data;
  const importDate = options.importDate ?? (data && typeof data === "object"
    ? latestDataDate({
        snapshotDates: [
          ...(data.dailyRawSnapshots ?? []).map((snapshot) => snapshot?.date),
          ...(data.dailyBossRawSnapshots ?? []).map((snapshot) => snapshot?.date),
        ],
        fallbacks: [data.captures?.lastImportedAt, data.captures?.lastCapturedAt],
      })
    : null);
  if (!importDate) return null;
  const [year, month, day] = importDate.split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
}

export function utcTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
