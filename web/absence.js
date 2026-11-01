// Legacy end-only records cannot establish an earlier approved start date.
export function absencePeriods(member = {}) {
  member ??= {};
  return [...(member.absences ?? []), ...(member.absenceUntil ? [{ from: member.absenceFrom ?? member.absenceUntil, until: member.absenceUntil }] : [])];
}

export function isDeclaredAbsent(member, date) {
  return Boolean(date && absencePeriods(member).some(period => period.from <= date && date <= period.until));
}
