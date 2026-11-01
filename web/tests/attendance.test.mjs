import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceSummary, compareAttendance, isDeclaredAbsent } from '../attendance.js';
const rules = { minBossTries: 1, maxInactiveDays: 3 };
const rows = [1,2,3].map(day => ({ date: `2026-10-0${day}`, bossAttacks: 0 }));
test('consecutive misses differ from an isolated miss and missing observations break streaks', () => {
  assert.equal(attendanceSummary(rows, rules, {}, '2026-10-03').streak, 3);
  assert.equal(attendanceSummary([rows[0], rows[2]], rules, {}, '2026-10-03').streak, 1);
  assert.equal(attendanceSummary([rows[2]], rules, {}, '2026-10-03').pattern, 'single');
});
test('recurrence windows, thresholds, absence bounds and severity ranking', () => {
  const member = { absenceFrom: '2026-10-02', absenceUntil: '2026-10-02' };
  const result = attendanceSummary(rows, { ...rules, attendanceRepeatThreshold: 2 }, member, '2026-10-03');
  assert.equal(result.misses, 2);
  assert.equal(result.pattern, 'recurrent');
  assert.equal(result.history[1].excused, true);
  assert.equal(result.history[1].warnings.length, 0);
  assert.equal(isDeclaredAbsent(member, '2026-10-01'), false);
  assert.equal(isDeclaredAbsent(member, '2026-10-03'), false);
  assert.equal(attendanceSummary(rows, { ...rules, attendanceWindowDays: 1 }, {}, '2026-10-03').misses, 1);
  const absent = attendanceSummary(rows, rules, { absenceFrom: '2026-10-01', absenceUntil: '2026-10-03' }, '2026-10-03');
  assert.equal(absent.status, 'Declared absence');
  assert.equal(absent.misses, 0);
  const inactive = attendanceSummary([{ ...rows[2], lastActivityDays: 4 }], rules, {}, '2026-10-03');
  assert.equal(inactive.status, 'Undeclared inactive');
  assert.ok(compareAttendance(inactive, result) < 0);
  assert.ok(compareAttendance(result, absent) < 0);
  assert.equal(attendanceSummary(rows, rules, {}, '2026-10-04').streak, 0);
});
test('inactivity uses the exact configured boundary and requires a current observation', () => {
  const row = { date: '2026-10-03', bossAttacks: 1, lastActivityDays: 2 };
  assert.equal(attendanceSummary([row], rules, {}, row.date).status, 'Active');
  assert.equal(attendanceSummary([{...row,lastActivityDays:3}], rules, {}, row.date).status, 'Undeclared inactive');
  assert.equal(attendanceSummary([{...row,lastActivityDays:3}], rules, {absenceFrom:row.date,absenceUntil:row.date}, row.date).status, 'Declared absence');
  assert.notEqual(attendanceSummary([{...row,lastActivityDays:3}], rules, {}, '2026-10-04').status, 'Undeclared inactive');
});
