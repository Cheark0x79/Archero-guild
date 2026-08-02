"use client";

import { useEffect, useMemo, useState } from "react";

import { chartPointsForRange } from "../../lib/chart-points.js";
import styles from "./shared.module.css";

const CHART_RANGES = ["week", "month", "all"];

export default function SharedMemberProfile({ profile, expiresAt, lastImportDate }) {
  const { member } = profile;
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>A2</span>
          <span><strong>Archero Guild</strong><small>Shared member profile</small></span>
        </div>
        <div className={styles.expiry}>Link expires <LocalTimestamp value={expiresAt} /></div>
      </header>

      <div className={styles.content}>
        <section className={styles.profileHeader}>
          <div className={styles.identity}>
            <div className={styles.avatar}>{member.name?.slice(0, 1)?.toUpperCase() ?? "?"}</div>
            <div>
              <h1>{member.name}</h1>
              <p>Player ID {member.playerId} · {roleLabel(member.role)}</p>
              <div className={styles.pills}>
                <span className={styles.positivePill}>{statusLabel(member.guildStatus)}</span>
                <span className={styles.pill}>Last seen {formatDate(member.lastSeenAt)}</span>
              </div>
            </div>
          </div>
          <span className={styles.readOnly}>🔒 Read-only access</span>
        </section>

        <section className={styles.stats} aria-label="Current member statistics">
          <Stat label="Power" value={formatCompact(member.metrics.power)} detail={formatPeriodDelta(profile.powerWeekDelta, "vs 7 days ago")} />
          <Stat label="Contribution" value={formatNumber(member.metrics.contribution7d)} detail={formatDelta(member.metrics.contributionDelta)} />
          <Stat label="Previous day boss attacks" value={formatBossAttacks(profile.previousDayBossAttacks)} detail={`Import dated ${formatDate(profile.checkpointDate)}`} />
          <Stat label="Power guild rank" value={ordinal(profile.powerRank.rank)} />
        </section>

        <section className={styles.chartGrid}>
          <ProgressChart title="Power progression" points={profile.powerHistory} valueFormatter={formatCompact} />
          <ProgressChart title="Boss damage progression" points={profile.bossDamageHistory} valueFormatter={formatDamage} />
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div><h2>Personal bests by boss</h2><p>Best damage and guild placement</p></div>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Boss</th><th>Personal best</th><th>Guild rank</th><th>Recorded</th></tr></thead>
              <tbody>
                {profile.personalBests.map((record) => (
                  <tr key={record.boss.key}>
                    <td><span className={styles.bossName}><img src={record.boss.imagePath} alt="" />{record.boss.name}</span></td>
                    <td>{formatDamage(record.bestDamage)}</td>
                    <td>{ordinal(record.guildRank, "Not ranked")}</td>
                    <td>{formatDate(record.bestDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.recentPanel}`}>
          <div className={styles.sectionHeading}>
            <div><h2>Recent boss results</h2><p>Latest recorded imports</p></div>
          </div>
          <div className={styles.recentList}>
            {profile.recentBossResults.length ? profile.recentBossResults.map((result) => (
              <div className={styles.recentRow} key={`${result.date}-${result.boss.key}`}>
                <span>{formatDate(result.date)}</span>
                <strong>{result.boss.name}</strong>
                <span>{formatDamage(result.damage)}</span>
                <span>{result.guildRank ? `Guild ${ordinal(result.guildRank)}` : "Not ranked"}</span>
              </div>
            )) : <p className={styles.muted}>No boss result recorded yet.</p>}
          </div>
        </section>

        <p className={styles.checkpoint}>Data checkpoint: <LocalTimestamp value={lastImportDate} /></p>
      </div>

      <footer className={styles.footer}>🛡️ This temporary link grants access to this member profile only.</footer>
    </main>
  );
}

function Stat({ label, value, detail }) {
  return <article className={styles.stat}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

function LocalTimestamp({ value }) {
  const [label, setLabel] = useState("Local time…");
  useEffect(() => setLabel(formatTimestamp(value)), [value]);
  return <span>{label}</span>;
}

function ProgressChart({ title, points, valueFormatter }) {
  const [range, setRange] = useState("week");
  const visiblePoints = useMemo(() => chartPointsForRange(points, range), [points, range]);
  const chart = chartGeometry(visiblePoints);

  return (
    <article className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        <div className={styles.rangeControls} aria-label={`${title} range`}>
          {CHART_RANGES.map((key) => (
            <button type="button" className={range === key ? styles.activeRange : ""} aria-pressed={range === key} onClick={() => setRange(key)} key={key}>
              {key === "all" ? "All" : key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {visiblePoints.length ? (
        <>
          <svg className={styles.chart} viewBox="0 0 600 230" role="img" aria-label={`${title}, ${visiblePoints.length} data points`}>
            {chart.grid.map((y) => <line className={styles.gridLine} x1="58" x2="570" y1={y} y2={y} key={y} />)}
            <text className={styles.chartLabel} x="4" y="32">{valueFormatter(chart.maximum)}</text>
            <text className={styles.chartLabel} x="4" y="184">{valueFormatter(chart.minimum)}</text>
            <path className={styles.chartArea} d={chart.areaPath} />
            <path className={styles.chartLine} d={chart.linePath} />
            {chart.points.map((point) => (
              <g key={point.date}>
                <text className={styles.pointLabel} x={point.x} y={point.y - 12} textAnchor="middle">{valueFormatter(point.value)}</text>
                <circle className={styles.chartDot} cx={point.x} cy={point.y} r="5">
                  <title>{`${formatDate(point.date)} — ${valueFormatter(point.value)}`}</title>
                </circle>
              </g>
            ))}
            <text className={styles.chartLabel} x="58" y="218">{formatShortDate(visiblePoints[0].date)}</text>
            <text className={styles.chartLabel} x="570" y="218" textAnchor="end">{formatShortDate(visiblePoints.at(-1).date)}</text>
          </svg>
        </>
      ) : <p className={styles.muted}>No data in this period.</p>}
    </article>
  );
}

function chartGeometry(points) {
  if (!points.length) {
    return { minimum: 0, maximum: 0, points: [], grid: [42, 111, 180], linePath: "", areaPath: "" };
  }
  const values = points.map((point) => point.value);
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max((rawMaximum - rawMinimum) * 0.16, rawMaximum * 0.04, 1);
  const minimum = Math.max(0, rawMinimum - padding);
  const maximum = rawMaximum + padding;
  const plotted = points.map((point, index) => ({
    ...point,
    x: 58 + (index / Math.max(points.length - 1, 1)) * 512,
    y: 180 - ((point.value - minimum) / Math.max(maximum - minimum, 1)) * 138,
  }));
  const linePath = plotted.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
  return {
    minimum,
    maximum,
    points: plotted,
    grid: [28, 104, 180],
    linePath,
    areaPath: `${linePath} L${plotted.at(-1).x} 180 L${plotted[0].x} 180 Z`,
  };
}

function formatNumber(value) { return typeof value === "number" ? value.toLocaleString("en-US") : "—"; }
function formatCompact(value) {
  if (typeof value !== "number") return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatNumber(value);
}
function formatDamage(value) {
  if (typeof value !== "number") return "No record";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return formatNumber(value);
}
function formatDelta(value) { return typeof value === "number" ? `${value >= 0 ? "+" : ""}${formatCompact(value)} since previous import` : "No comparison"; }
function formatPeriodDelta(value, period) { return typeof value === "number" ? `${value >= 0 ? "+" : ""}${formatCompact(value)} ${period}` : ""; }
function formatBossAttacks(value) { return typeof value === "number" ? `${value} / 2` : "Not recorded"; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "Not recorded"; }
function formatShortDate(value) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : ""; }
function formatTimestamp(value) {
  return value ? new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value)) : "unknown";
}
function roleLabel(role) { return ({ leader: "Guild leader", officer: "Vice-leader", elder: "Elder", member: "Guild member" })[role] ?? "Guild member"; }
function statusLabel(status) { return ({ active: "Active member", left: "Former member", kicked: "Former member" })[status] ?? "Guild member"; }
function ordinal(value, fallback = "—") {
  if (!Number.isInteger(value) || value < 1) return fallback;
  const remainder100 = value % 100;
  const suffix = remainder100 >= 11 && remainder100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[value % 10] ?? "th";
  return `${value}${suffix}`;
}
