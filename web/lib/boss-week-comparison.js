export function buildBossWeekComparison(days, options = {}) {
  const bossKeys = Array.isArray(options.bossKeys) ? options.bossKeys.filter(Boolean) : [];
  const resolveBossKey = typeof options.resolveBossKey === "function" ? options.resolveBossKey : (day) => day?.bossKey;
  const includePlayer = typeof options.includePlayer === "function" ? options.includePlayer : () => true;
  if (bossKeys.length === 0) return null;

  const weeks = new Map();
  for (const day of Array.isArray(days) ? days : []) {
    if (!validDate(day?.date)) continue;
    const bossKey = resolveBossKey(day);
    if (!bossKeys.includes(bossKey)) continue;
    const weekStart = mondayWeekStart(day.date);
    const week = weeks.get(weekStart) ?? { weekStart, weekEnd: addDays(weekStart, 6), bosses: new Map() };
    const boss = week.bosses.get(bossKey) ?? { bossKey, total: 0, players: new Set(), date: day.date };
    for (const row of Array.isArray(day.rows) ? day.rows : []) {
      if (!includePlayer(row?.playerId) || !Number.isFinite(row?.bossDamageToday)) continue;
      boss.total += Math.max(0, row.bossDamageToday);
      if (row.playerId) boss.players.add(row.playerId);
    }
    boss.date = day.date;
    week.bosses.set(bossKey, boss);
    weeks.set(weekStart, week);
  }

  const completeWeeks = [...weeks.values()]
    .filter((week) => bossKeys.every((bossKey) => week.bosses.has(bossKey)))
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const latest = completeWeeks.at(-1);
  if (!latest) return null;
  const previous = completeWeeks.at(-2) ?? null;

  return {
    weekStart: latest.weekStart,
    weekEnd: latest.weekEnd,
    previousWeekStart: previous?.weekStart ?? null,
    rows: bossKeys.map((bossKey) => {
      const current = latest.bosses.get(bossKey);
      const previousTotal = previous?.bosses.get(bossKey)?.total ?? null;
      return {
        bossKey,
        date: current.date,
        total: current.total,
        participants: current.players.size,
        previousTotal,
        deltaPercent: previousTotal > 0 ? ((current.total - previousTotal) / previousTotal) * 100 : null,
      };
    }),
  };
}

function mondayWeekStart(value) {
  const current = new Date(`${value}T12:00:00Z`);
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - weekday + 1);
  return current.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const current = new Date(`${value}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
