export const DAILY_DONATION_PER_MEMBER = 500;

export function buildDonationChartDays(snapshots, isIncludedPlayer = () => true) {
  const ordered = Array.isArray(snapshots)
    ? snapshots.filter((snapshot) => validDate(snapshot?.date)).slice().sort((left, right) => left.date.localeCompare(right.date))
    : [];
  const previousByPlayer = new Map();

  return ordered
    .map((snapshot) => {
      const weekStart = mondayWeekStart(snapshot.date);
      let cumulative = 0;
      let dailyGain = 0;
      let count = 0;

      for (const row of Array.isArray(snapshot.rows) ? snapshot.rows : []) {
        if (!isIncludedPlayer(row.playerId) || !Number.isFinite(row.contribution7d)) continue;
        const current = Math.max(0, row.contribution7d);
        const previous = previousByPlayer.get(row.playerId);
        const gain = previous?.weekStart === weekStart && current >= previous.value
          ? current - previous.value
          : current;
        cumulative += current;
        dailyGain += gain;
        count += 1;
        previousByPlayer.set(row.playerId, { value: current, weekStart });
      }

      return count > 0 ? { date: snapshot.date, total: dailyGain, cumulative, count } : null;
    })
    .filter(Boolean);
}

export function donationTarget(memberCount, days = 1) {
  if (!Number.isFinite(memberCount) || memberCount < 0 || !Number.isFinite(days) || days <= 0) return null;
  return memberCount * DAILY_DONATION_PER_MEMBER * days;
}

export function latestDonationWeekPoints(rows) {
  const ordered = Array.isArray(rows)
    ? rows.filter((row) => validDate(row?.date)).slice().sort((left, right) => left.date.localeCompare(right.date))
    : [];
  const latestDate = ordered.at(-1)?.date;
  if (!latestDate) return [];
  const weekStart = mondayWeekStart(latestDate);
  const weekEnd = addDaysIso(weekStart, 6);
  return ordered.filter((row) => row.date >= weekStart && row.date <= weekEnd);
}

function mondayWeekStart(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - weekday + 1);
  return current.toISOString().slice(0, 10);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function addDaysIso(value, days) {
  const current = new Date(`${value}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}
