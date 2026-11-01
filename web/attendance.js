import { evaluateWarningHistory } from './warning-history.js';
import { isDeclaredAbsent } from './absence.js';
export { isDeclaredAbsent } from './absence.js';
const DAY = 86400000;
const integer = (value, fallback) => Number.isInteger(value) && value > 0 && value <= 365 ? value : fallback;

export function attendanceSummary(rows, rules = {}, member = {}, date = rules.currentDate) {
  const windowDays = integer(rules.attendanceWindowDays, 14);
  const repeatThreshold = Math.max(2, integer(rules.attendanceRepeatThreshold, 3));
  const streakThreshold = Math.max(2, integer(rules.attendanceStreakThreshold, 3));
  const ordered = [...new Map((rows ?? []).filter(row => row?.date && (!date || row.date <= date)).map(row => [row.date, row])).values()].sort((a,b) => a.date.localeCompare(b.date));
  const asOf = date ?? ordered.at(-1)?.date;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const history = evaluateWarningHistory(ordered, rules, member).filter(row => Date.parse(`${row.date}T00:00:00Z`) > end - windowDays * DAY);
  const missed = row => row.warnings.some(w => ['missed_boss', 'low_contribution'].includes(w.type));
  const misses = history.filter(missed).length;
  let streak = 0;
  let expected = end;
  for (const row of [...history].reverse()) {
    const time = Date.parse(`${row.date}T00:00:00Z`);
    if (time !== expected || !missed(row)) break;
    streak++;
    expected -= DAY;
  }
  const absent = isDeclaredAbsent(member, asOf);
  const latest = ordered.at(-1);
  const inactive = !absent && latest?.date === asOf && Number.isFinite(latest.lastActivityDays) && latest.lastActivityDays >= (rules.maxInactiveDays ?? 3);
  const pattern = streak >= streakThreshold ? 'consecutive' : misses >= repeatThreshold ? 'recurrent' : misses > 1 ? 'multiple' : misses === 1 ? 'single' : 'clear';
  const status = absent ? 'Declared absence' : inactive ? 'Undeclared inactive' : 'Active';
  const detail = `${streak} consecutive missed days · ${misses} misses in the last ${windowDays} days`;
  return { status, pattern, streak, misses, windowDays, detail, penaltyCount: history.reduce((sum,row) => sum + row.warnings.length, 0), rank: absent ? 0 : (inactive ? 4 : pattern === 'consecutive' ? 3 : pattern === 'recurrent' ? 2 : misses ? 1 : 0), history: history.map(row => ({ ...row, excused: isDeclaredAbsent(member, row.date) })) };
}

export function compareAttendance(left, right) {
  return right.rank - left.rank || right.streak - left.streak || right.misses - left.misses;
}
