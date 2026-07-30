export function localIsoDate(value = new Date(), timeZone = "Europe/Paris") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function latestDataDate({ preferred = null, snapshotDates = [], fallbacks = [] } = {}) {
  const preferredDate = isoDatePrefix(preferred);
  if (preferredDate) return preferredDate;

  const latestSnapshot = acceptedSnapshotDates(snapshotDates).at(-1);
  if (latestSnapshot) return latestSnapshot;

  for (const fallback of fallbacks) {
    const fallbackDate = isoDatePrefix(fallback);
    if (fallbackDate) return fallbackDate;
  }
  return null;
}

export function acceptedSnapshotDates(values = []) {
  return [...new Set(values.map(isoDatePrefix).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isoDatePrefix(value) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  return match?.[1] ?? null;
}
