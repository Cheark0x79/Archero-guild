const formatNumber = (value) => value.toLocaleString("en-US");
const validXp = (value) => Number.isSafeInteger(value) && value >= 0;
const validLevel = (value) => Number.isSafeInteger(value) && value > 0;

// History contains accepted snapshots keyed by game date, not import time.
// The current snapshot is authoritative if a date is represented more than once.
export function guildExperienceDetail(current = {}, history = []) {
  const progress = validXp(current.xpCurrent) && validXp(current.xpRequired)
    ? `${formatNumber(current.xpCurrent)} / ${formatNumber(current.xpRequired)} XP`
    : "Experience not captured";
  const byDate = new Map();
  for (const snapshot of Array.isArray(history) ? history : []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(snapshot?.date ?? "")) byDate.set(snapshot.date, snapshot);
  }
  const previousDate = [...byDate.keys()].filter((date) => date < current.date).sort().at(-1);
  const previous = byDate.get(previousDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(current.date ?? "") || !previous
      || !validLevel(current.level) || !validLevel(previous.level)
      || !validXp(current.xpCurrent) || !validXp(previous.xpCurrent)) {
    return `${progress} · No daily comparison`;
  }
  // Requirements for intervening levels are not available; never infer a gain
  // from counters that may have reset, even when the new counter is higher.
  if (current.level !== previous.level) return `${progress} · Level changed; gain unknown`;
  const delta = current.xpCurrent - previous.xpCurrent;
  return `${progress} · ${delta >= 0 ? "+" : ""}${formatNumber(delta)} since ${previousDate}`;
}
