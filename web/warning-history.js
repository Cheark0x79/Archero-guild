const DAY_MS = 86_400_000;

export function evaluateWarningHistory(rows, rules, member = {}) {
  const ordered = [...(rows ?? [])]
    .filter((row) => row?.date)
    .sort((left, right) => left.date.localeCompare(right.date));

  return ordered.map((row, index) => ({
    ...row,
    warnings: warningsForRow(row, ordered.slice(0, index), rules ?? {}, member),
  }));
}

export function warningHistoryEvents(rows, rules, member = {}) {
  return evaluateWarningHistory(rows, rules, member).flatMap((row) =>
    row.warnings.map((warning) => ({
      ...warning,
      date: row.date,
      id: `${row.date}:${warning.type}`,
    })),
  );
}

export function warningHistorySummary(events) {
  const byType = {};
  for (const event of events ?? []) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;
  }
  return {
    total: events?.length ?? 0,
    byType,
    lastWarningAt: events?.at(-1)?.date ?? null,
  };
}

function warningsForRow(row, previousRows, rules, member) {
  if (isInGracePeriod(row.date, member.joinedAt, rules.newMemberGraceDays)) return [];

  const warnings = [];
  const activityDays = numberOrNull(row.lastActivityDays);
  const contribution = numberOrNull(row.contribution7d ?? row.donation);
  const bossAttacks = numberOrNull(row.bossAttacks);
  const power = numberOrNull(row.power);

  if (activityDays != null && numberOrNull(rules.maxInactiveDays) != null && activityDays >= rules.maxInactiveDays) {
    warnings.push({
      type: "game_absence",
      label: "Game absence",
      severity: "warning",
      value: activityDays,
      threshold: rules.maxInactiveDays,
      detail: `${activityDays} day(s) without connection; maximum ${rules.maxInactiveDays}.`,
    });
  }

  if (contribution != null && numberOrNull(rules.minContribution7d) != null && contribution < rules.minContribution7d) {
    warnings.push({
      type: "low_contribution",
      label: "Low contribution",
      severity: "warning",
      value: contribution,
      threshold: rules.minContribution7d,
      detail: `${contribution} donation; minimum ${rules.minContribution7d}.`,
    });
  }

  const baseline = powerBaseline(previousRows, row.date);
  if (power != null && baseline?.power > 0 && numberOrNull(rules.minPowerGrowth14dPercent) != null) {
    const growth = round((power - baseline.power) / baseline.power * 100, 2);
    if (growth < rules.minPowerGrowth14dPercent) {
      warnings.push({
        type: "low_progression",
        label: "Low progression",
        severity: "warning",
        value: growth,
        threshold: rules.minPowerGrowth14dPercent,
        baselineDate: baseline.date,
        detail: `${growth}% power growth since ${baseline.date}; minimum ${rules.minPowerGrowth14dPercent}%.`,
      });
    }
  }

  if (bossAttacks != null && numberOrNull(rules.minBossTries) != null && bossAttacks < rules.minBossTries) {
    warnings.push({
      type: "missed_boss",
      label: "Missed boss",
      severity: "warning",
      value: bossAttacks,
      threshold: rules.minBossTries,
      detail: `${bossAttacks} boss try/tries; minimum ${rules.minBossTries}.`,
    });
  }

  return warnings;
}

function powerBaseline(previousRows, currentDate) {
  const currentTime = dateTime(currentDate);
  if (currentTime == null) return null;
  return [...previousRows]
    .reverse()
    .find((row) => {
      const rowTime = dateTime(row.date);
      return rowTime != null
        && currentTime - rowTime >= 14 * DAY_MS
        && numberOrNull(row.power) != null;
    }) ?? null;
}

function isInGracePeriod(date, joinedAt, graceDays) {
  const joinedTime = dateTime(joinedAt);
  const currentTime = dateTime(date);
  const days = numberOrNull(graceDays);
  if (joinedTime == null || currentTime == null || days == null || days <= 0) return false;
  const ageDays = Math.floor((currentTime - joinedTime) / DAY_MS);
  return ageDays >= 0 && ageDays < days;
}

function dateTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
