export function bossDefinitionForSnapshot(snapshot, definitions) {
  const available = Array.isArray(definitions) ? definitions : [];
  const explicitKey = snapshot?.boss?.key ?? snapshot?.bossKey;
  if (explicitKey) {
    const stored = available.find((boss) => boss.key === explicitKey);
    if (stored) return stored;
    return {
      ...(snapshot?.boss ?? {}),
      key: explicitKey,
      name: snapshot?.boss?.name ?? explicitKey,
      weekday: snapshot?.boss?.weekday ?? null,
      dayLabel: snapshot?.boss?.dayLabel ?? null,
    };
  }
  return bossDefinitionForDate(snapshot?.date, available);
}

export function bossDefinitionForDate(date, definitions) {
  const available = Array.isArray(definitions) ? definitions : [];
  const [year, month, day] = String(date).split("-").map(Number);
  if (!year || !month || !day) return available[0] ?? null;
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return available.find((boss) => boss.weekday === weekday) ?? available[0] ?? null;
}
