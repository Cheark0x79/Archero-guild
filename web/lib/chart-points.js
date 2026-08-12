const RANGE_DAYS = { week: 7, month: 30, twoMonths: 56, all: null };

const MINIMUM_RELATIVE_SPAN = 0.4;
const DATA_SPAN_MULTIPLIER = 1.4;

export function adaptiveChartDomain(values) {
  const finiteValues = Array.isArray(values) ? values.filter(Number.isFinite) : [];
  if (!finiteValues.length) return { minimum: 0, maximum: 1, span: 1 };

  const rawMinimum = Math.min(...finiteValues);
  const rawMaximum = Math.max(...finiteValues);
  const dataSpan = rawMaximum - rawMinimum;
  const valueLevel = Math.max(Math.abs(rawMinimum), Math.abs(rawMaximum), 1);
  const visibleSpan = Math.max(valueLevel * MINIMUM_RELATIVE_SPAN, dataSpan * DATA_SPAN_MULTIPLIER);
  const padding = (visibleSpan - dataSpan) / 2;
  let minimum = rawMinimum - padding;
  let maximum = rawMaximum + padding;

  // Guild metrics cannot be negative. Shift the domain upward rather than
  // clipping it so the requested visual span remains intact around zero.
  if (minimum < 0) {
    maximum -= minimum;
    minimum = 0;
  }

  return { minimum, maximum, span: Math.max(maximum - minimum, Number.EPSILON) };
}

export function chartPointsForRange(points, range, maximumPoints = 7) {
  const source = Array.isArray(points) ? points.filter(validPoint).sort((left, right) => left.date.localeCompare(right.date)) : [];
  if (!source.length) return [];
  const days = RANGE_DAYS[range];
  const ranged = days == null ? source : pointsSince(source, days);
  return evenlySample(ranged, maximumPoints);
}

export function weeklyPowerDelta(points) {
  const source = Array.isArray(points) ? points.filter(validPoint).sort((left, right) => left.date.localeCompare(right.date)) : [];
  const latest = source.at(-1);
  if (!latest) return null;
  const target = new Date(`${latest.date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - 7);
  const targetDate = target.toISOString().slice(0, 10);
  const baseline = [...source].reverse().find((point) => point.date <= targetDate);
  return baseline ? latest.value - baseline.value : null;
}

export function completedSundayPoints(points, weekCount = null, maximumPoints = 7) {
  const source = Array.isArray(points)
    ? points
        .filter(validPoint)
        .sort((left, right) => left.date.localeCompare(right.date))
        .filter((point) => new Date(`${point.date}T12:00:00Z`).getUTCDay() === 0)
    : [];
  const ranged = typeof weekCount === "number" ? source.slice(-weekCount) : source;
  return evenlySample(ranged, maximumPoints);
}

function pointsSince(points, days) {
  const latest = new Date(`${points.at(-1).date}T00:00:00Z`);
  const minimum = new Date(latest);
  minimum.setUTCDate(minimum.getUTCDate() - days + 1);
  const minimumDate = minimum.toISOString().slice(0, 10);
  return points.filter((point) => point.date >= minimumDate);
}

function evenlySample(points, maximumPoints) {
  if (points.length <= maximumPoints) return points;
  const sampled = Array.from({ length: maximumPoints }, (_, index) => {
    const sourceIndex = Math.round(index * (points.length - 1) / (maximumPoints - 1));
    return points[sourceIndex];
  });
  return sampled.filter((point, index) => index === 0 || point.date !== sampled[index - 1].date);
}

function validPoint(point) {
  return /^\d{4}-\d{2}-\d{2}$/.test(point?.date ?? "") && typeof point?.value === "number";
}
