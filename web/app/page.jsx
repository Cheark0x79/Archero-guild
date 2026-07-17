"use client";

import { useEffect, useMemo, useState } from "react";
import {
  captures,
  changes,
  dailyBossRawSnapshots,
  dailyRawSnapshots,
  guildRoster,
  memberSnapshots,
  ocrQueue,
  previousMemberSnapshots,
  rules as defaultRules,
} from "../sample-data.js";
import {
  activityLabel,
  buildSummary,
  compareSourceRows,
  defaultSortDirection,
  evaluateMember,
  filterMembers,
  formatBossDamageText,
  formatCompact,
  formatNumber,
  formatPowerDetail,
  lineChartPath,
  mergeRosterMetrics,
  newMemberDay,
  sortMembers,
  topBy,
} from "../metrics.js";

const RULES_STORAGE_KEY = "archero-observer-rules";
const CHECK_VALIDATION_STORAGE_KEY = "archero-observer-check-validation";
const members = mergeRosterMetrics(guildRoster, memberSnapshots);

const navItems = [
  ["dashboard", "Dashboard"],
  ["members", "Members"],
  ["boss", "Boss"],
  ["check", "Check"],
  ["rankings", "Rankings"],
  ["activity", "History"],
  ["ocr", "OCR review"],
  ["settings", "Rules"],
];

const routeMeta = {
  dashboard: ["Dashboard", "Operational view of contributions, progression, and alerts."],
  members: ["Members", "Search, status, and individual progression."],
  boss: ["Boss", "Guild boss damage comparison, rankings, and records."],
  check: ["Check", "Raw imported values by captured day."],
  member: ["Member detail", "Daily history, progression, MI activity, notes, and warnings."],
  rankings: ["Rankings", "Top contribution, boss, and weekly progression."],
  activity: ["History", "Roster events, absences, and warnings."],
  ocr: ["OCR review", "Validation queue for uncertain OCR values."],
  settings: ["Rules", "Editable local thresholds before backend wiring."],
};

export default function DashboardApp() {
  const [route, setRoute] = useHashRoute();
  const [rules, setRules] = useStoredRules();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState({ key: null, direction: "asc" });
  const [detailRanges, setDetailRanges] = useState({ progression: "1w", mi: "1w", donation: "1w" });
  const [annotations, setAnnotations] = useState(() =>
    Object.fromEntries(members.map((member) => [memberKey(member), { notes: [], warnings: [...(member.warnings ?? [])] }])),
  );

  const activeRoute = route.startsWith("member:") ? "member" : routeMeta[route] ? route : "dashboard";
  const selectedMember = activeRoute === "member" ? findMemberFromRoute(route) : null;
  const [title, subtitle] = routeMeta[activeRoute];

  return (
    <div className="app-shell">
      <Sidebar activeRoute={activeRoute} />
      <main className="main">
        <header className="topbar">
          <div>
            <h1>{selectedMember?.name ?? title}</h1>
            <p>
              {selectedMember
                ? `${selectedMember.playerId ?? "Missing ID"} · ${roleLabel(selectedMember.role)} · ${activityLabel(selectedMember.lastActivityDays)}`
                : subtitle}
            </p>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" title="Refresh data" aria-label="Refresh data">
              ↻
            </button>
            <button className="primary-button" type="button">
              Import snapshot
            </button>
          </div>
        </header>

        {activeRoute === "dashboard" && <Dashboard rules={rules} />}
        {activeRoute === "members" && (
          <MembersView query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} sort={sort} setSort={setSort} rules={rules} />
        )}
        {activeRoute === "boss" && <BossView />}
        {activeRoute === "check" && <CheckView />}
        {activeRoute === "member" && selectedMember && (
          <MemberDetail
            member={selectedMember}
            rules={rules}
            ranges={detailRanges}
            setRanges={setDetailRanges}
            annotations={annotations}
            setAnnotations={setAnnotations}
          />
        )}
        {activeRoute === "rankings" && <Rankings />}
        {activeRoute === "activity" && <HistoryView annotations={annotations} />}
        {activeRoute === "ocr" && <OcrReview />}
        {activeRoute === "settings" && <RulesView rules={rules} setRules={setRules} />}
      </main>
    </div>
  );
}

function Sidebar({ activeRoute }) {
  const navRoute = activeRoute === "member" ? "members" : activeRoute;
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          A2
        </div>
        <div>
          <strong>Archero Observer</strong>
          <span>Guild management</span>
        </div>
      </div>
      <nav className="nav-list" aria-label="Pages">
        {navItems.map(([key, label]) => (
          <a key={key} href={`#${key}`} data-route={key} className={navRoute === key ? "active" : ""}>
            {label}
          </a>
        ))}
      </nav>
      <div className="sidebar-note">
        <span>Last update</span>
        <strong>{formatDateTime(captures.lastImportedAt ?? captures.lastCapturedAt)}</strong>
      </div>
    </aside>
  );
}

function Dashboard({ rules }) {
  const summary = buildSummary(members, rules);
  const cards = [
    ["Members", summary.members, `${summary.freeSlots} free slot(s), ${summary.formerMembers} former`],
    ["Known IDs", summary.knownIds, `${summary.unresolvedIds} missing`],
    ["Discord linked", summary.discordLinked, `${summary.discordMissing} missing / to verify`],
    ["Verified data", `${summary.verifiedMetrics}/${summary.currentMembers}`, `${summary.reviewRequired} need review`],
    ["Donation", formatNumber(summary.totalContribution), deltaDetail(summary.totalContributionDelta)],
    ["Boss tries", formatNumber(summary.bossAttacks), deltaDetail(summary.bossAttacksDelta)],
    ["Watch list", summary.watchCount, "Automatic rules"],
  ];
  const watched = members
    .map((member) => ({ member, evaluation: evaluateMember(member, rules) }))
    .filter(({ member, evaluation }) => member.metricsVerified && ["warning", "danger"].includes(evaluation.severity))
    .slice(0, 5);

  return (
    <>
      <div className="metrics-grid">
        {cards.map(([label, value, detail]) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <ChartPanel title="30-day contribution" subtitle="Daily guild total" badge="30d" values={captures.contribution30d} label="Contribution" value={formatNumber(captures.contribution30d.at(-1))} />
        <ChartPanel title="Average power" subtitle="Weekly trend for active members" badge="+7d" values={captures.averagePower8w} label="Average power" value={formatCompact(captures.averagePower8w.at(-1))} positive />
        <section className="panel">
          <PanelHeading title="Members to watch" subtitle="Game absence, low contribution, or missed boss" />
          <div className="watch-list">
            {watched.length === 0 ? (
              <p className="muted">No verified alerts yet. Review captured metrics before applying rules.</p>
            ) : (
              watched.map(({ member, evaluation }) => (
                <article className="watch-item" key={memberKey(member)}>
                  <header>
                    <strong>{member.name}</strong>
                    <StatusPill label={evaluation.status} severity={evaluation.severity} />
                  </header>
                  <span className="muted">{evaluation.flags.join(" · ")}</span>
                  <span className="muted">{deltaLine(member)}</span>
                </article>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHeading title="Recent changes" subtitle="Name changes, joins, and departures" />
          <EventList events={changes} />
        </section>
      </div>
    </>
  );
}

function MembersView({ query, setQuery, statusFilter, setStatusFilter, sort, setSort, rules }) {
  const summary = buildSummary(members, rules);
  const visibleMembers = sortMembers(filterMembers(members, rules, query, statusFilter), rules, sort);
  const cards = [
    ["Current guild", `${summary.currentMembers} members`, `${summary.formerMembers} former record(s)`],
    ["Known IDs", summary.knownIds, `${summary.unresolvedIds} name(s) without ID`],
    ["Discord linked", `${summary.discordLinked} members`, `${summary.discordMissing} missing / to verify`],
    ["Verified metrics", `${summary.verifiedMetrics} members`, `${summary.reviewRequired} need review`],
  ];

  function toggleSort(key) {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: defaultSortDirection(key) },
    );
  }

  return (
    <>
      <div className="toolbar">
        <label className="search-field">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Name, Discord, or ID" />
        </label>
        <label className="select-field">
          <span>Filter</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {[
              ["all", "All"],
              ["active", "Active"],
              ["watch", "Watch"],
              ["absent", "Game absence"],
              ["officer", "Officers"],
              ["discord-linked", "On Discord"],
              ["discord-missing", "Missing Discord"],
              ["review", "Needs review"],
              ["missing", "Metrics missing"],
              ["unresolved", "Missing ID"],
              ["former", "Former members"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="identity-metrics">
        {cards.map(([label, value, detail]) => (
          <article className="metric-card compact" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <section className="panel table-panel">
        <div className="table-wrap">
          <table className="members-table">
            <colgroup>
              <col className="col-player-id" />
              <col className="col-name" />
              <col className="col-discord" />
              <col className="col-role" />
              <col className="col-absence" />
              <col className="col-donation" />
              <col className="col-boss-tries" />
              <col className="col-power" />
              <col className="col-capture" />
              <col className="col-alerts" />
            </colgroup>
            <thead>
              <tr>
                {[
                  ["playerId", "Player ID"],
                  ["name", "Name"],
                  ["discord", "Discord"],
                  ["role", "Role"],
                  ["activity", "Game absence"],
                  ["donation", "Donation"],
                  ["bossTries", "Boss tries"],
                  ["power", "Power"],
                  ["capture", "Last seen"],
                  ["alerts", "Alerts"],
                ].map(([key, label]) => (
                  <th key={key}>
                    <button className={`sort-button ${sort.key === key ? `active ${sort.direction}` : ""}`} type="button" onClick={() => toggleSort(key)}>
                      {label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => (
                <MemberRow member={member} rules={rules} key={memberKey(member)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function BossView() {
  const bossData = useMemo(() => buildBossDashboardData(), []);
  const [selectedPlayers, setSelectedPlayers] = useState(() => new Set(bossData.players.map((player) => player.playerId)));
  const selectedSeries = bossData.players.filter((player) => selectedPlayers.has(player.playerId));

  function togglePlayer(playerId) {
    setSelectedPlayers((current) => {
      const next = new Set(current);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedPlayers(new Set(bossData.players.map((player) => player.playerId)));
  }

  function clearAll() {
    setSelectedPlayers(new Set());
  }

  function selectOnly(playerId) {
    setSelectedPlayers(new Set([playerId]));
  }

  return (
    <div className="boss-page">
      <section className="panel boss-chart-panel">
        <PanelHeading
          title="Guild boss damage"
          subtitle={`${selectedSeries.length}/${bossData.players.length} members visible across ${bossData.dates.length} captured day(s).`}
          action={
            <div className="boss-chart-actions">
              <button className="secondary-button compact-action" type="button" onClick={selectAll}>
                All
              </button>
              <button className="secondary-button compact-action" type="button" onClick={clearAll}>
                None
              </button>
            </div>
          }
        />
        <BossMultiLineChart dates={bossData.dates} series={selectedSeries} />
      </section>

      <section className="panel boss-selector-panel">
        <PanelHeading title="Members" subtitle="Check members to display them in the graph." />
        <div className="boss-player-grid">
          {bossData.players.map((player) => (
            <label className="boss-player-toggle" key={player.playerId}>
              <input type="checkbox" checked={selectedPlayers.has(player.playerId)} onChange={() => togglePlayer(player.playerId)} />
              <span className="boss-color-dot" style={{ background: player.color }} aria-hidden="true" />
              <span>
                <strong>{player.name}</strong>
                <small>{formatBossDamageText(player.latestDamage)} latest</small>
              </span>
              <button className="secondary-button compact-action" type="button" onClick={(event) => { event.preventDefault(); selectOnly(player.playerId); }}>
                Solo
              </button>
            </label>
          ))}
        </div>
      </section>

      <div className="boss-ranking-grid">
        <BossRankingPanel title="Best day" subtitle="Best single-day damage recorded per member" rows={bossData.bestDayRecords} valueKey="damage" showDate />
        <BossDailyRankingPanel days={bossData.dailyRankings} />
      </div>
    </div>
  );
}

function BossMultiLineChart({ dates, series }) {
  if (dates.length === 0 || series.length === 0) {
    return <div className="boss-chart-empty">Select at least one member with boss damage history.</div>;
  }

  const width = 1080;
  const height = 430;
  const padding = { top: 28, right: 36, bottom: 46, left: 64 };
  const values = series.flatMap((player) => player.points.map((point) => point.damage));
  const max = Math.max(...values, 1);
  const scaleMax = max * 1.08;
  const xForDate = (date) => {
    const index = dates.indexOf(date);
    return dates.length === 1 ? width / 2 : padding.left + (index * (width - padding.left - padding.right)) / (dates.length - 1);
  };
  const yForDamage = (value) => height - padding.bottom - (value / scaleMax) * (height - padding.top - padding.bottom);
  const gridValues = [0.25, 0.5, 0.75, 1].map((ratio) => scaleMax * ratio);

  return (
    <div className="boss-multi-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Guild boss damage comparison">
        {gridValues.map((value) => {
          const y = yForDamage(value);
          return (
            <g key={value}>
              <path className="chart-grid-line" d={`M ${padding.left} ${y.toFixed(1)} L ${width - padding.right} ${y.toFixed(1)}`} />
              <text className="chart-axis-label" x={padding.left - 10} y={(y + 4).toFixed(1)} textAnchor="end">
                {formatBossDamageText(value)}
              </text>
            </g>
          );
        })}
        <path className="chart-grid-line" d={`M ${padding.left} ${height - padding.bottom} L ${width - padding.right} ${height - padding.bottom}`} />
        {dates.map((date) => {
          const x = xForDate(date);
          return (
            <g key={date}>
              <path className="chart-tick-line" d={`M ${x.toFixed(1)} ${height - padding.bottom - 5} L ${x.toFixed(1)} ${height - padding.bottom + 5}`} />
              <text className="chart-axis-label" x={x.toFixed(1)} y={height - 14} textAnchor="middle">
                {formatShortDate(date)}
              </text>
            </g>
          );
        })}
        {series.map((player) => {
          const path = player.points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${xForDate(point.date).toFixed(1)} ${yForDamage(point.damage).toFixed(1)}`)
            .join(" ");
          return (
            <g key={player.playerId}>
              {player.points.length > 1 ? <path className="boss-series-line" d={path} style={{ stroke: player.color }} /> : null}
              {player.points.map((point) => (
                <circle className="boss-series-point" cx={xForDate(point.date).toFixed(1)} cy={yForDamage(point.damage).toFixed(1)} r="4" style={{ stroke: player.color }} key={point.date} />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BossRankingPanel({ title, subtitle, rows, valueKey, showDate = false }) {
  return (
    <section className="panel">
      <PanelHeading title={title} subtitle={subtitle} />
      <div className="boss-ranking-list">
        {rows.length === 0 ? (
          <p className="muted">No boss damage recorded.</p>
        ) : (
          rows.slice(0, 10).map((row, index) => (
            <div className="boss-ranking-row" key={`${title}-${row.playerId}-${row.date ?? row.weekStart ?? index}`}>
              <span className="rank-number">{index + 1}</span>
              <div>
                <strong>{row.name}</strong>
                <small>{showDate ? row.date : null}</small>
              </div>
              <span>{formatBossDamageText(row[valueKey])}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function BossDailyRankingPanel({ days }) {
  return (
    <section className="panel boss-daily-panel">
      <PanelHeading title="Daily ranking" subtitle="Damage ranking for each captured day." />
      <div className="boss-day-list">
        {days.length === 0 ? (
          <p className="muted">No boss damage recorded.</p>
        ) : (
          days.map((day) => (
            <article className="boss-day-card" key={day.date}>
              <header>
                <h3>{day.date}</h3>
                <span className="muted">{day.rows.length} records</span>
              </header>
              <div className="boss-ranking-list compact">
                {day.rows.slice(0, 10).map((row, index) => (
                  <div className="boss-ranking-row" key={`${day.date}-${row.playerId}`}>
                    <span className="rank-number">{index + 1}</span>
                    <div>
                      <strong>{row.name}</strong>
                      <small>{row.bossRank ? `Game rank ${row.bossRank}` : "No game rank"}</small>
                    </div>
                    <span>{formatBossDamageText(row.damage)}</span>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function CheckView() {
  const days = useMemo(() => buildCheckDays(), []);
  const [dayIndex, setDayIndex] = useState(Math.max(0, days.length - 1));
  const [validatedRows, setValidatedRows] = useCheckValidation();
  const [checkMode, setCheckMode] = useState("guild");
  const [sourceSortDirection, setSourceSortDirection] = useState("asc");
  const [checkQuery, setCheckQuery] = useState("");
  const selectedDay = days[dayIndex] ?? null;
  const rows = selectedDay?.rows ?? [];
  const visibleRows = rows.filter((row) => row.captureType === checkMode && checkRowMatchesQuery(row, checkQuery));
  const orderedRows = useMemo(
    () =>
      [...visibleRows].sort((left, right) => {
        const leftStatus = checkReviewStatus(validatedRows, selectedDay?.date, left.reviewId);
        const rightStatus = checkReviewStatus(validatedRows, selectedDay?.date, right.reviewId);
        const sourceOrder = compareSourceOrder(left, right);
        return checkReviewRank(leftStatus) - checkReviewRank(rightStatus) || (sourceSortDirection === "asc" ? sourceOrder : -sourceOrder);
      }),
    [selectedDay?.date, sourceSortDirection, validatedRows, visibleRows],
  );
  const validCount = visibleRows.filter((row) => checkReviewStatus(validatedRows, selectedDay?.date, row.reviewId) === "valid").length;
  const invalidCount = visibleRows.filter((row) => checkReviewStatus(validatedRows, selectedDay?.date, row.reviewId) === "invalid").length;
  const reviewedCount = validCount + invalidCount;
  const guildCount = rows.filter((row) => row.captureType === "guild").length;
  const bossCount = rows.filter((row) => row.captureType === "boss").length;

  function previousDay() {
    setDayIndex((current) => Math.max(0, current - 1));
  }

  function nextDay() {
    setDayIndex((current) => Math.min(days.length - 1, current + 1));
  }

  function toggleSourceSort() {
    setSourceSortDirection((current) => (current === "asc" ? "desc" : "asc"));
  }

  function setRowReview(reviewId, status) {
    if (!selectedDay) return;
    const key = checkRowKey(selectedDay.date, reviewId);
    setValidatedRows((current) => {
      const next = { ...current };
      if (checkReviewStatus(next, selectedDay.date, reviewId) === status) {
        delete next[key];
      } else {
        next[key] = status;
      }
      return next;
    });
  }

  return (
    <section className="panel table-panel check-panel">
      <div className="panel-heading check-heading">
        <div>
          <h2>{checkMode === "guild" ? "Guild raw check" : "Boss ranking check"}</h2>
          <p>
            {reviewedCount}/{visibleRows.length} reviewed. Good {validCount}, bad {invalidCount}.
          </p>
        </div>
        <div className="check-actions">
          <div className="day-stepper" aria-label="Captured day selector">
            <button className="secondary-button" type="button" onClick={previousDay} disabled={dayIndex === 0}>
              Previous day
            </button>
            <strong>{selectedDay?.date ?? "No day"}</strong>
            <button className="secondary-button" type="button" onClick={nextDay} disabled={dayIndex >= days.length - 1}>
              Next day
            </button>
          </div>
        </div>
      </div>
      <div className="check-mode-tabs" role="tablist" aria-label="Check type">
        <button className={checkMode === "guild" ? "active" : ""} type="button" role="tab" aria-selected={checkMode === "guild"} onClick={() => setCheckMode("guild")}>
          <span>Guild</span>
          <strong>{guildCount}</strong>
        </button>
        <button className={checkMode === "boss" ? "active" : ""} type="button" role="tab" aria-selected={checkMode === "boss"} onClick={() => setCheckMode("boss")}>
          <span>Boss</span>
          <strong>{bossCount}</strong>
        </button>
      </div>
      <div className="check-toolbar">
        <label>
          <span>Search</span>
          <input value={checkQuery} onChange={(event) => setCheckQuery(event.target.value)} placeholder="Name or ID" type="search" />
        </label>
      </div>
      <div className="table-wrap">
        <table className={`check-table ${checkMode === "boss" ? "boss-check-table" : "guild-check-table"}`}>
          <colgroup>
            <col className="col-check-status" />
            {checkMode === "guild" ? (
              <>
                <col className="col-check-name" />
                <col className="col-check-role" />
                <col className="col-check-power" />
                <col className="col-check-boss" />
                <col className="col-check-donation" />
                <col className="col-check-source" />
              </>
            ) : (
              <>
                <col className="col-check-rank" />
                <col className="col-check-name" />
                <col className="col-check-damage" />
                <col className="col-check-source" />
                <col className="col-check-notes" />
              </>
            )}
          </colgroup>
          <thead>
            {checkMode === "guild" ? (
              <tr>
                <th>Check</th>
                <th>User</th>
                <th>Role</th>
                <th className="numeric">Power</th>
                <th className="numeric">MI tries</th>
                <th className="numeric">Donation</th>
                <th>
                  <button className={`sort-button active ${sourceSortDirection}`} type="button" onClick={toggleSourceSort}>
                    Source
                  </button>
                </th>
              </tr>
            ) : (
              <tr>
                <th>Check</th>
                <th className="numeric">Rank</th>
                <th>Name</th>
                <th className="numeric">Damage</th>
                <th>
                  <button className={`sort-button active ${sourceSortDirection}`} type="button" onClick={toggleSourceSort}>
                    Source raw
                  </button>
                </th>
                <th>Status</th>
              </tr>
            )}
          </thead>
          <tbody>
            {orderedRows.map((row) => {
              const reviewStatus = checkReviewStatus(validatedRows, selectedDay?.date, row.reviewId);
              const isValid = reviewStatus === "valid";
              const isInvalid = reviewStatus === "invalid";
              return (
                <tr className={reviewStatus ? `check-row-${reviewStatus}` : ""} key={row.reviewId}>
                  <td>
                    <CheckReviewButtons
                      label={row.name}
                      date={selectedDay?.date}
                      isValid={isValid}
                      isInvalid={isInvalid}
                      onMarkValid={() => setRowReview(row.reviewId, "valid")}
                      onMarkInvalid={() => setRowReview(row.reviewId, "invalid")}
                    />
                  </td>
                  {checkMode === "guild" ? (
                    <>
                      <td>
                        <div className="player-cell">
                          <strong>{row.name}</strong>
                          <small>{row.playerId}</small>
                        </div>
                      </td>
                      <td>{roleLabel(row.role)}</td>
                      <td className="numeric">{formatOptionalCompact(row.power)}</td>
                      <td className="numeric">{formatOptionalNumber(row.bossAttacks)}</td>
                      <td className="numeric">{formatOptionalNumber(row.contribution7d)}</td>
                      <td>
                        <span className="muted">{row.source}</span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="numeric">{formatOptionalNumber(row.bossRank)}</td>
                      <td>{row.name}</td>
                      <td className="numeric">{formatBossDamageText(row.bossDamageToday, row.bossDamageText)}</td>
                      <td>
                        <span className="muted">{row.source}</span>
                      </td>
                      <td>
                        <span className="muted">{row.status}</span>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckReviewButtons({ label, date, isValid, isInvalid, onMarkValid, onMarkInvalid }) {
  return (
    <div className="check-toggle-group">
      <button
        className={`check-toggle good ${isValid ? "checked" : ""}`}
        type="button"
        aria-label={`${isValid ? "Uncheck good" : "Mark good"} ${label} on ${date}`}
        aria-pressed={isValid}
        title={isValid ? "Uncheck good" : "Mark good"}
        onClick={onMarkValid}
      >
        ✓
      </button>
      <button
        className={`check-toggle bad ${isInvalid ? "checked" : ""}`}
        type="button"
        aria-label={`${isInvalid ? "Uncheck bad" : "Mark bad"} ${label} on ${date}`}
        aria-pressed={isInvalid}
        title={isInvalid ? "Uncheck bad" : "Mark bad"}
        onClick={onMarkInvalid}
      >
        !
      </button>
    </div>
  );
}

function checkRowMatchesQuery(row, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [row.name, row.playerId, row.source, row.role].filter(Boolean).join(" ").toLowerCase().includes(normalized);
}

function MemberRow({ member, rules }) {
  const evaluation = evaluateMember(member, rules);
  return (
    <tr className={`member-row ${rowStateClass(evaluation)} clickable-row`} onClick={() => setHashRoute(`member:${encodeURIComponent(memberKey(member))}`)}>
      <td>
        <div className="player-cell">
          <strong>{member.playerId ?? "Missing ID"}</strong>
        </div>
      </td>
      <td>
        <a className="member-link" href={`#member:${encodeURIComponent(memberKey(member))}`} onClick={(event) => event.stopPropagation()}>
          <strong>{member.name}</strong>
          <NewMemberBadge member={member} rules={rules} />
        </a>
      </td>
      <td>
        <DiscordDot member={member} />
      </td>
      <td>{roleLabel(member.role)}</td>
      <td>{activityLabel(member.lastActivityDays)}</td>
      <td className="numeric">
        <ValueWithDelta value={formatOptionalNumber(member.contribution7d)} delta={member.contributionDelta} formatter={formatNumber} />
      </td>
      <td className="numeric">
        <ValueWithDelta value={formatOptionalNumber(member.bossAttacks)} delta={member.bossAttacksDelta} formatter={formatNumber} />
      </td>
      <td className="numeric">
        <ValueWithDelta value={formatOptionalCompact(member.power)} delta={member.powerDelta} formatter={formatCompact} />
      </td>
      <td>
        <CapturePill member={member} />
      </td>
      <td>
        <StatusPill label={evaluation.status} severity={evaluation.severity} />
      </td>
    </tr>
  );
}

function MemberDetail({ member, rules, ranges, setRanges, annotations, setAnnotations }) {
  const evaluation = evaluateMember(member, rules);
  const history = dailyHistory(member);
  const weeklyHistory = filterHistoryByRange(history, "1w");
  const memberAnnotations = annotations[memberKey(member)] ?? { notes: [], warnings: [] };
  const needs = evaluation.flags.map((flag) => ({ label: flag, severity: evaluation.severity, detail: needDetail(flag, member, rules) }));

  function setRange(chart, range) {
    setRanges((current) => ({ ...current, [chart]: range }));
  }

  function addAnnotation(type, value) {
    if (!value.trim()) return;
    setAnnotations((current) => updateMemberAnnotations(current, member, type, (items) => [{ [annotationValueKey(type)]: value.trim(), at: todayLabel() }, ...items]));
  }

  function updateAnnotation(type, index, value) {
    if (!value.trim()) return;
    setAnnotations((current) =>
      updateMemberAnnotations(current, member, type, (items) =>
        items.map((item, itemIndex) => (itemIndex === index ? { ...item, [annotationValueKey(type)]: value.trim(), editing: false } : item)),
      ),
    );
  }

  function setEditing(type, index, editing) {
    setAnnotations((current) =>
      updateMemberAnnotations(current, member, type, (items) => items.map((item, itemIndex) => ({ ...item, editing: itemIndex === index ? editing : false }))),
    );
  }

  function deleteAnnotation(type, index) {
    setAnnotations((current) => updateMemberAnnotations(current, member, type, (items) => items.filter((_, itemIndex) => itemIndex !== index)));
  }

  return (
    <>
      <div className="detail-actions">
        <a className="secondary-button" href="#members">
          Back to members
        </a>
        <StatusPill label={evaluation.status} severity={evaluation.severity} />
      </div>
      <div className="member-detail-grid">
        <section className="panel detail-hero">
          <div className="detail-title">
            <div>
              <h2>
                {member.name} <NewMemberBadge member={member} rules={rules} />
              </h2>
              <p>
                {member.playerId ?? "Missing ID"} · {roleLabel(member.role)}
              </p>
            </div>
            <DiscordDot member={member} />
          </div>
          <div className="detail-metrics">
            <DetailMetric label="Power" value={formatOptionalCompact(member.power)} delta={member.powerDelta} formatter={formatCompact} />
            <DetailMetric label="Donation" value={formatOptionalNumber(member.contribution7d)} delta={member.contributionDelta} formatter={formatNumber} />
            <DetailMetric label="MI tries" value={formatOptionalNumber(member.bossAttacks)} delta={member.bossAttacksDelta} formatter={formatNumber} />
            <DetailMetric label="Last activity" value={activityLabel(member.lastActivityDays)} />
            <DetailMetric label="Joined guild" value={member.joinedAt ?? "Not recorded"} />
          </div>
        </section>
        <section className="panel">
          <PanelHeading title="Needs" subtitle="Automatic checks against the current rules" />
          <div className="need-list">
            {needs.length === 0 ? (
              <p className="muted">No current rule issue.</p>
            ) : (
              needs.map((need) => (
                <div className="need-row" key={need.label}>
                  <StatusPill label={need.label} severity={need.severity} />
                  <span>{need.detail}</span>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHeading title="Progression graph" subtitle="Power from first captured snapshot to latest" action={<RangeSelector chart="progression" ranges={ranges} setRange={setRange} />} />
          <HistoryChart rows={filterHistoryByRange(history, ranges.progression)} dataKey="power" formatter={formatPowerDetail} emptyText="No power history captured yet." />
        </section>
        <section className="panel">
          <PanelHeading title="MI damage graph" subtitle="Guild boss damage from first captured snapshot to latest" action={<RangeSelector chart="mi" ranges={ranges} setRange={setRange} />} />
          <HistoryChart rows={filterHistoryByRange(history, ranges.mi)} dataKey="bossDamage" formatter={formatBossDamageText} emptyText="MI damage is not recorded in the current screenshots yet." />
        </section>
        <section className="panel wide">
          <PanelHeading title="Daily history" subtitle="Captured days in the current week." />
          <HistoryTable rows={weeklyHistory} />
        </section>
        <AnnotationPanel
          title="Warnings"
          subtitle="Officer-tracked behavior issues"
          type="warnings"
          items={memberAnnotations.warnings}
          emptyText="No warnings recorded for this member."
          placeholder="Reason, e.g. attacked guildmates in arena"
          onAdd={addAnnotation}
          onEdit={updateAnnotation}
          onDelete={deleteAnnotation}
          onSetEditing={setEditing}
        />
        <AnnotationPanel
          title="Officer notes"
          subtitle="Context that should affect moderation decisions"
          type="notes"
          items={memberAnnotations.notes}
          emptyText="No notes recorded for this member."
          placeholder="Add a note or announced absence context"
          onAdd={addAnnotation}
          onEdit={updateAnnotation}
          onDelete={deleteAnnotation}
          onSetEditing={setEditing}
        />
      </div>
    </>
  );
}

function Rankings() {
  const groups = [
    ["Top contribution", topBy(members, "contribution7d"), "contribution7d"],
    ["Top boss tries", topBy(members, "bossAttacks"), "bossAttacks"],
    ["Top progression", topBy(members, "power7d"), "power7d"],
  ];
  return (
    <div className="rankings-grid">
      {groups.map(([title, rows, key]) => (
        <section className="panel" key={title}>
          <PanelHeading title={title} subtitle="Latest snapshot ranking" />
          <div className="ranking-list">
            {rows.length === 0 ? (
              <p className="muted">No verified ranking data yet.</p>
            ) : (
              rows.map((member, index) => (
                <div className="ranking-row" key={`${title}-${memberKey(member)}`}>
                  <span className="rank-number">{index + 1}</span>
                  <strong>{member.name}</strong>
                  <span>{key === "power7d" ? signedCompact(member[key]) : formatCompact(member[key])}</span>
                </div>
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function HistoryView({ annotations }) {
  const currentMembers = members.filter((member) => !["inactive", "left", "kicked"].includes(member.status));
  const capturedMembers = currentMembers.filter((member) => member.metricsVerified);
  const maxContribution = Math.max(...capturedMembers.map((member) => member.contribution7d ?? 0), 1);
  const rows = [...capturedMembers].sort((a, b) => (b.contribution7d ?? 0) - (a.contribution7d ?? 0));
  const warnings = members.flatMap((member) => (annotations[memberKey(member)]?.warnings ?? []).map((warning) => ({ member, warning })));
  return (
    <div className="dashboard-grid">
      <section className="panel chart-panel wide">
        <PanelHeading title="Contribution by member" subtitle="Quick read of weekly targets" />
        <div className="bar-list">
          {rows.map((member) => (
            <div className="bar-row" key={memberKey(member)}>
              <strong>{member.name}</strong>
              <div className="bar-track" aria-hidden="true">
                <div className="bar-fill" style={{ width: `${Math.max(2, ((member.contribution7d ?? 0) / maxContribution) * 100)}%` }} />
              </div>
              <span className="numeric">{formatNumber(member.contribution7d ?? 0)}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelHeading title="Roster history" subtitle="Human review to confirm by an officer" />
        <EventList events={changes} />
      </section>
      <section className="panel">
        <PanelHeading title="Announced absences" subtitle="Excused members are not pushed into the watch list" />
        <p className="muted">No announced absences recorded yet.</p>
      </section>
      <section className="panel">
        <PanelHeading title="Warnings" subtitle="Officer-tracked behavior notes" />
        <div className="event-list">
          {warnings.length === 0 ? (
            <p className="muted">No warnings recorded yet.</p>
          ) : (
            warnings.map(({ member, warning }, index) => (
              <article className="event-item" key={`${memberKey(member)}-${index}`}>
                <header>
                  <strong>{member.name}</strong>
                  <span className="muted">{warning.at ?? "No date"}</span>
                </header>
                <span>{warning.reason}</span>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function OcrReview() {
  return (
    <section className="panel table-panel">
      <div className="panel-heading">
        <div>
          <h2>OCR review queue</h2>
          <p>Low-confidence values or values inconsistent with history</p>
        </div>
        <StatusPill label={`${ocrQueue.length} to review`} severity="warning" />
      </div>
      <div className="ocr-list">
        {ocrQueue.length === 0 ? (
          <article className="ocr-item">
            <strong>No OCR review items</strong>
            <span>This screen is empty because the current app is still using static sample data. Once the OCR worker writes low-confidence records, they will appear here.</span>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function RulesView({ rules, setRules }) {
  const ruleRows = [
    ["maxInactiveDays", "Absent", "days without activity", "High alert", "number"],
    ["minContribution7d", "Watch", "minimum 7-day donation", "Medium alert", "number"],
    ["minPowerGrowth14dPercent", "Low progression", "minimum 14-day power growth %", "Medium alert", "number"],
    ["minBossTries", "Missed boss", "minimum boss tries per event day", "High alert", "number"],
    ["newMemberGraceDays", "New member", "grace period in days", "Rule pause", "number"],
    ["memberCapacity", "Capacity", "guild member slots", "Free slot tracking", "number"],
  ];
  return (
    <div className="settings-grid">
      {ruleRows.map(([key, name, label, effect]) => (
        <section className="panel" key={key}>
          <label className="rule-row">
            <strong>{name}</strong>
            <span>{label}</span>
            <input
              className="rule-input"
              type="number"
              min="0"
              step={key === "minPowerGrowth14dPercent" ? "0.1" : "1"}
              value={rules[key]}
              onChange={(event) => setRules((current) => ({ ...current, [key]: Number(event.target.value) }))}
            />
            <span className="muted">{effect}</span>
          </label>
        </section>
      ))}
    </div>
  );
}

function AnnotationPanel({ title, subtitle, type, items, emptyText, placeholder, onAdd, onEdit, onDelete, onSetEditing }) {
  const [value, setValue] = useState("");
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <StatusPill label={String(items.length)} severity="neutral" />
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(type, value);
          setValue("");
        }}
      >
        <input value={value} onChange={(event) => setValue(event.target.value)} type="text" placeholder={placeholder} />
        <button className="primary-button" type="submit">
          {type === "warnings" ? "Add warning" : "Add note"}
        </button>
      </form>
      <div className="event-list detail-list">
        {items.length === 0 ? (
          <p className="muted">{emptyText}</p>
        ) : (
          items.map((item, index) => (
            <AnnotationItem key={`${type}-${index}`} type={type} item={item} index={index} onEdit={onEdit} onDelete={onDelete} onSetEditing={onSetEditing} />
          ))
        )}
      </div>
    </section>
  );
}

function AnnotationItem({ type, item, index, onEdit, onDelete, onSetEditing }) {
  const [value, setValue] = useState(item[annotationValueKey(type)] ?? "");
  if (item.editing) {
    return (
      <article className="event-item annotation-item">
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onEdit(type, index, value);
          }}
        >
          <input value={value} onChange={(event) => setValue(event.target.value)} type="text" />
          <button className="primary-button" type="submit">
            Save
          </button>
          <button className="secondary-button" type="button" onClick={() => onSetEditing(type, index, false)}>
            Cancel
          </button>
        </form>
      </article>
    );
  }
  return (
    <article className="event-item annotation-item">
      <header>
        <strong>{item[annotationValueKey(type)]}</strong>
        <span className="muted">{item.at ?? "Today"}</span>
      </header>
      <div className="annotation-actions">
        <button className="secondary-button compact-action" type="button" onClick={() => onSetEditing(type, index, true)}>
          Edit
        </button>
        <button className="secondary-button compact-action danger-action" type="button" onClick={() => onDelete(type, index)}>
          Delete
        </button>
      </div>
    </article>
  );
}

function ChartPanel({ title, subtitle, badge, values, label, value, positive }) {
  const { line, area } = lineChartPath(values, 720, 230);
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <StatusPill label={badge} severity={positive ? "positive" : "neutral"} />
      </div>
      <div className="chart">
        <svg viewBox="0 0 720 230" role="img" aria-label={`${label}: ${value}`}>
          <path className="chart-area" d={area} />
          <path className="chart-line" d={line} />
          <text className="chart-label" x="22" y="24">
            {label}
          </text>
          <text className="chart-label" x="698" y="24" textAnchor="end">
            {value}
          </text>
        </svg>
      </div>
    </section>
  );
}

function HistoryChart({ rows, dataKey, formatter, emptyText }) {
  const points = rows
    .map((row, index) => ({ date: row.date, value: row[dataKey], slotIndex: index }))
    .filter((point) => typeof point.value === "number");
  if (points.length === 0) return <div className="chart-empty">{emptyText}</div>;
  const width = 720;
  const height = 230;
  const padding = 28;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const paddingValue = Math.max(1, Math.abs(average) * 0.01, (max - min) * 0.25);
  const scaleMin = Math.max(0, min - paddingValue);
  const scaleMax = max + paddingValue;
  const range = Math.max(1, scaleMax - scaleMin);
  const slots = Math.max(rows.length, points.length, 1);
  const coordinates = points.map((point) => {
    const x = slots === 1 ? width / 2 : padding + (point.slotIndex * (width - padding * 2)) / (slots - 1);
    const y = height - padding - ((point.value - scaleMin) / range) * (height - padding * 2);
    return { ...point, x, y };
  });
  const valueDates = new Set(points.map((point) => point.date));
  const line = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const latest = coordinates.at(-1);
  return (
    <div className="detail-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${formatter(latest.value)} on ${latest.date}`}>
        <path className="chart-grid-line" d={`M ${padding} ${height - padding} L ${width - padding} ${height - padding}`} />
        {rows.map((row, index) => {
          const x = rows.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (rows.length - 1);
          return (
            <g key={row.date}>
              <path className="chart-tick-line" d={`M ${x.toFixed(1)} ${height - padding - 4} L ${x.toFixed(1)} ${height - padding + 4}`} />
              {!valueDates.has(row.date) ? <circle className="chart-missing-point" cx={x.toFixed(1)} cy={height - padding} r="3" /> : null}
              <text className="chart-axis-label" x={x.toFixed(1)} y={height - 8} textAnchor="middle">
                {formatShortDate(row.date)}
              </text>
            </g>
          );
        })}
        {coordinates.length > 1 ? <path className="chart-area" d={`${line} L ${latest.x.toFixed(1)} ${height - padding} L ${coordinates[0].x.toFixed(1)} ${height - padding} Z`} /> : null}
        <path className="chart-line" d={line} />
        {coordinates.map((point) => (
          <circle className="chart-point" cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r="5" key={point.date} />
        ))}
        {coordinates.map((point, index) => (
          <text className="chart-value-label" x={point.x.toFixed(1)} y={chartValueLabelY(point, index).toFixed(1)} textAnchor="middle" key={`${point.date}-value`}>
            {formatter(point.value)}
          </text>
        ))}
        <text className="chart-label" x={padding} y="24">
          {rows[0]?.date ?? points[0].date}
        </text>
        <text className="chart-label" x={width - padding} y="24" textAnchor="end">
          {rows.at(-1)?.date ?? latest.date}
        </text>
      </svg>
    </div>
  );
}

function chartValueLabelY(point, index) {
  return Math.max(18, point.y - 12 - (index % 2) * 8);
}

function HistoryTable({ rows }) {
  if (rows.length === 0) return <p className="muted">No captured daily history for this member yet.</p>;
  return (
    <div className="table-wrap compact-table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Power</th>
            <th>Donation</th>
            <th>MI tries</th>
            <th>MI damage</th>
            <th>Activity</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <td>{row.date}</td>
              <td>
                <ValueWithDelta value={formatOptionalPower(row.power)} delta={row.powerDelta} formatter={formatCompact} />
              </td>
              <td>
                <ValueWithDelta value={formatOptionalNumber(row.donation)} delta={row.donationDelta} formatter={formatNumber} />
              </td>
              <td>
                <ValueWithDelta value={formatOptionalNumber(row.bossAttacks)} delta={row.bossAttacksDelta} formatter={formatNumber} />
              </td>
              <td>{formatOptionalBossDamage(row.bossDamage, row.bossDamageText)}</td>
              <td>{row.activity}</td>
              <td>
                <span className="muted">{row.source}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelHeading({ title, subtitle, action }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function RangeSelector({ chart, ranges, setRange }) {
  return (
    <div className="range-selector" aria-label="Chart range">
      {[
        ["1w", "1W"],
        ["1m", "1M"],
        ["all", "All"],
      ].map(([value, label]) => (
        <button className={ranges[chart] === value ? "active" : ""} type="button" onClick={() => setRange(chart, value)} key={value}>
          {label}
        </button>
      ))}
    </div>
  );
}

function EventList({ events }) {
  return (
    <div className="event-list">
      {events.map((event) => (
        <article className="event-item" key={event.title}>
          <header>
            <strong>{event.title}</strong>
            <span className="muted">{event.at}</span>
          </header>
          <span>{event.detail}</span>
        </article>
      ))}
    </div>
  );
}

function StatusPill({ label, severity }) {
  return <span className={`status-pill ${severity}`}>{label}</span>;
}

function CapturePill({ member }) {
  if (["inactive", "left", "kicked"].includes(member.status)) return <span className="muted">Former</span>;
  if (!member.playerId) return <span className="muted">Missing ID</span>;
  if (!member.lastSeenAt) return <span className="muted">Not seen</span>;
  return <time dateTime={member.lastSeenAt}>{member.lastSeenAt}</time>;
}

function DiscordDot({ member }) {
  const label = member.discordLinked ? "Member is on Discord" : "Member is not linked on Discord";
  return (
    <span className={`discord-dot ${member.discordLinked ? "linked" : "missing"}`} title={label} aria-label={label}>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function DetailMetric({ label, value, delta, formatter }) {
  return (
    <div className="detail-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof delta === "number" ? <small className={`delta ${delta > 0 ? "positive" : "neutral"}`}>{signedFormatted(delta, formatter)}</small> : null}
    </div>
  );
}

function ValueWithDelta({ value, delta, formatter }) {
  if (typeof delta !== "number") return value;
  return (
    <span className="value-stack">
      <span>{value}</span>
      <span className={`delta ${delta > 0 ? "positive" : "neutral"}`}>{signedFormatted(delta, formatter)}</span>
    </span>
  );
}

function NewMemberBadge({ member, rules }) {
  const day = newMemberDay(member, rules);
  return day == null ? null : <span className="new-member-tag">New +{day}j</span>;
}

function useHashRoute() {
  const [route, setRoute] = useState("dashboard");
  useEffect(() => {
    const sync = () => setRoute(window.location.hash.replace("#", "") || "dashboard");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return [route, setRoute];
}

function useStoredRules() {
  const initialRules = useMemo(() => normalizeRules({ ...defaultRules, currentDate: currentImportDate() }), []);
  const [rules, setRules] = useState(initialRules);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) ?? "{}");
      setRules(normalizeRules({ ...defaultRules, ...stored, currentDate: currentImportDate() }));
    } catch {
      setRules(initialRules);
    }
  }, [initialRules]);
  useEffect(() => {
    const { currentDate, ...persistedRules } = rules;
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(persistedRules));
  }, [rules]);
  return [rules, setRules];
}

function useCheckValidation() {
  const [validatedRows, setValidatedRows] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = JSON.parse(localStorage.getItem(CHECK_VALIDATION_STORAGE_KEY) ?? "{}");
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem(CHECK_VALIDATION_STORAGE_KEY, JSON.stringify(validatedRows));
  }, [validatedRows]);
  return [validatedRows, setValidatedRows];
}

function updateMemberAnnotations(current, member, type, updater) {
  const key = memberKey(member);
  const existing = current[key] ?? { notes: [], warnings: [] };
  return {
    ...current,
    [key]: {
      ...existing,
      [type]: updater(existing[type] ?? []),
    },
  };
}

function checkRowKey(date, playerId) {
  return `${date ?? "unknown"}:${playerId}`;
}

function checkReviewStatus(validatedRows, date, playerId) {
  const value = validatedRows[checkRowKey(date, playerId)];
  if (value === true) return "valid";
  return value === "valid" || value === "invalid" ? value : null;
}

function checkReviewRank(status) {
  return status ? 1 : 0;
}

function compareSourceOrder(left, right) {
  return compareSourceRows(left, right);
}

function buildCheckDays() {
  const dailyMemberSnapshots = Array.isArray(dailyRawSnapshots) ? dailyRawSnapshots : [];
  const dailyBossSnapshots = Array.isArray(dailyBossRawSnapshots) ? dailyBossRawSnapshots : [];
  if (dailyMemberSnapshots.length > 0 || dailyBossSnapshots.length > 0) {
    const dayMap = new Map();
    for (const day of dailyMemberSnapshots) {
      dayMap.set(day.date, [...(dayMap.get(day.date) ?? []), ...buildCheckRows(day.rows, day.date)]);
    }
    for (const day of dailyBossSnapshots) {
      dayMap.set(day.date, [...(dayMap.get(day.date) ?? []), ...buildBossCheckRows(day.rows, day.date)]);
    }
    return [...dayMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, rows]) => ({ date, rows }));
  }

  const previousRows = buildCheckRows(previousMemberSnapshots, captures.lastCapturedAt.slice(0, 10));
  const currentRows = buildCheckRows(memberSnapshots, currentImportDate());
  return [
    previousRows.length ? { date: captures.lastCapturedAt.slice(0, 10), rows: previousRows } : null,
    currentRows.length ? { date: currentImportDate(), rows: currentRows } : null,
  ].filter(Boolean);
}

function buildCheckRows(snapshots, date) {
  const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.playerId, snapshot]));
  const currentRolesById = new Map(memberSnapshots.map((snapshot) => [snapshot.playerId, snapshot.role]));
  return guildRoster
    .filter((entry) => entry.playerId && snapshotsById.has(entry.playerId))
    .map((entry) => {
      const snapshot = snapshotsById.get(entry.playerId);
      return {
        captureType: "guild",
        reviewId: entry.playerId,
        playerId: entry.playerId,
        name: entry.name,
        role: checkRoleFor(entry.playerId, snapshot.role, currentRolesById),
        power: snapshot.power ?? null,
        contribution7d: snapshot.contribution7d ?? null,
        bossAttacks: snapshot.bossAttacks ?? null,
        bossDamageToday: snapshot.bossDamageToday ?? null,
        source: sourceFromVerification(snapshot.verificationNote) || `${date} snapshot`,
      };
    });
}

function checkRoleFor(playerId, rawRole, currentRolesById) {
  const currentRole = currentRolesById.get(playerId);
  if (["leader", "officer", "elder"].includes(currentRole)) return currentRole;
  return rawRole ?? "member";
}

function buildBossCheckRows(rows, date) {
  return rows.map((row) => ({
    captureType: "boss",
    reviewId: row.source,
    playerId: row.playerId ?? null,
    rowLabel: row.rowLabel ?? `Boss row ${row.rowIndex + 1}`,
    area: row.area ?? "list",
    name: row.name ?? usefulBossRawName(row.rawName) ?? "",
    rawName: row.rawName ?? null,
    role: "boss",
    bossRank: row.bossRank ?? null,
    power: null,
    contribution7d: null,
    bossAttacks: null,
    bossDamageText: row.damageText ?? null,
    bossDamageToday: row.bossDamageToday ?? null,
    source: row.source || `${date} guild-boss row`,
    status: bossCheckStatus(row),
  }));
}

function bossCheckStatus(row) {
  if (row.playerId) return "Matched";
  if (row.name || usefulBossRawName(row.rawName)) return "OCR only";
  if (typeof row.bossDamageToday === "number" || row.damageText) return "Damage only";
  return "Missing damage";
}

function usefulBossRawName(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.replace(/[^A-Za-z0-9]/g, "").length < 3) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]+[A-Za-z0-9]$/.test(cleaned)) return null;
  return cleaned;
}

function sourceFromVerification(value) {
  return value?.replace(/^Screenshot check: /, "").replace(/^Previous screenshot check: /, "").replace(/\.$/, "") ?? "";
}

function buildBossDashboardData() {
  const dates = Array.isArray(dailyBossRawSnapshots) ? dailyBossRawSnapshots.map((day) => day.date).sort((left, right) => left.localeCompare(right)) : [];
  const rosterNames = new Map(guildRoster.filter((entry) => entry.playerId).map((entry) => [entry.playerId, entry.name]));
  const playersById = new Map();

  for (const day of dailyBossRawSnapshots ?? []) {
    for (const row of day.rows ?? []) {
      if (!row.playerId || typeof row.bossDamageToday !== "number") continue;
      const current = playersById.get(row.playerId) ?? {
        playerId: row.playerId,
        name: row.name ?? rosterNames.get(row.playerId) ?? row.playerId,
        pointsByDate: new Map(),
      };
      current.name = row.name ?? current.name;
      const existingDamage = current.pointsByDate.get(day.date)?.damage;
      if (typeof existingDamage !== "number" || row.bossDamageToday > existingDamage) {
        current.pointsByDate.set(day.date, { date: day.date, damage: row.bossDamageToday, rank: row.bossRank ?? null });
      }
      playersById.set(row.playerId, current);
    }
  }

  const players = [...playersById.values()]
    .map((player, index) => {
      const points = [...player.pointsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
      return {
        playerId: player.playerId,
        name: player.name,
        color: bossSeriesColor(index),
        points,
        latestDamage: points.at(-1)?.damage ?? null,
      };
    })
    .sort((left, right) => (right.latestDamage ?? 0) - (left.latestDamage ?? 0) || left.name.localeCompare(right.name));

  players.forEach((player, index) => {
    player.color = bossSeriesColor(index);
  });

  return {
    dates,
    players,
    dailyRankings: bossDailyRankings(players),
    bestDayRecords: bossBestDayRecords(players),
  };
}

function bossDailyRankings(players) {
  const rowsByDate = new Map();
  for (const player of players) {
    for (const point of player.points) {
      rowsByDate.set(point.date, [
        ...(rowsByDate.get(point.date) ?? []),
        {
          playerId: player.playerId,
          name: player.name,
          damage: point.damage,
          bossRank: point.rank,
        },
      ]);
    }
  }
  return [...rowsByDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, rows]) => ({
      date,
      rows: rows.sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name)),
    }));
}

function bossBestDayRecords(players) {
  return players
    .map((player) => {
      const best = [...player.points].sort((left, right) => right.damage - left.damage)[0];
      return best
        ? {
            playerId: player.playerId,
            name: player.name,
            date: best.date,
            damage: best.damage,
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name));
}

function bossSeriesColor(index) {
  const colors = [
    "oklch(52% 0.15 225)",
    "oklch(52% 0.14 155)",
    "oklch(58% 0.17 35)",
    "oklch(50% 0.15 300)",
    "oklch(56% 0.15 80)",
    "oklch(48% 0.12 190)",
    "oklch(56% 0.16 15)",
    "oklch(44% 0.12 265)",
    "oklch(60% 0.14 135)",
    "oklch(46% 0.12 25)",
  ];
  return colors[index % colors.length];
}

function dailyHistory(member) {
  if (!member.metricsCaptured) return [];
  const rawHistory = dailySnapshotHistory(member);
  if (rawHistory.length > 0) return rawHistory;
  const rows = [];
  if (member.previousSnapshot) {
    rows.push({
      date: captures.lastCapturedAt.slice(0, 10),
      power: member.previousSnapshot.power,
      powerDelta: null,
      donation: member.previousSnapshot.contribution7d,
      donationDelta: null,
      bossAttacks: member.previousSnapshot.bossAttacks,
      bossAttacksDelta: null,
      bossDamage: null,
      activity: activityLabel(member.previousSnapshot.lastActivityDays),
      source: member.previousSnapshot.verificationNote || "Previous snapshot",
    });
  }
  rows.push(
    {
      date: currentImportDate(),
      power: member.power,
      powerDelta: member.powerDelta,
      donation: member.contribution7d,
      donationDelta: member.contributionDelta,
      bossAttacks: member.bossAttacks,
      bossAttacksDelta: member.bossAttacksDelta,
      bossDamage: member.bossDamageToday,
      activity: activityLabel(member.lastActivityDays),
      source: member.verificationNote || "Current snapshot",
    },
  );
  return rows;
}

function dailySnapshotHistory(member) {
  if (!member.playerId || !Array.isArray(dailyRawSnapshots)) return [];
  const rows = [];
  const bossSnapshotsByDate = dailyBossSnapshotsByDate(member.playerId);
  for (const day of dailyRawSnapshots) {
    const snapshot = day.rows?.find((row) => row.playerId === member.playerId);
    if (!snapshot) continue;
    const previous = rows.at(-1);
    const bossSnapshot = bossSnapshotsByDate.get(day.date);
    rows.push({
      date: day.date,
      power: snapshot.power,
      powerDelta: metricDelta(snapshot.power, previous?.power),
      donation: snapshot.contribution7d,
      donationDelta: metricDelta(snapshot.contribution7d, previous?.donation),
      bossAttacks: snapshot.bossAttacks,
      bossAttacksDelta: metricDelta(snapshot.bossAttacks, previous?.bossAttacks),
      bossDamage: bossSnapshot?.bossDamageToday ?? snapshot.bossDamageToday,
      bossDamageText: bossSnapshot?.damageText ?? null,
      activity: activityLabel(snapshot.lastActivityDays),
      source: snapshot.verificationNote || "Daily raw snapshot",
    });
  }
  return rows;
}

function dailyBossSnapshotsByDate(playerId) {
  const snapshots = new Map();
  if (!playerId || !Array.isArray(dailyBossRawSnapshots)) return snapshots;
  for (const day of dailyBossRawSnapshots) {
    const snapshot = day.rows?.find((row) => row.playerId === playerId && typeof row.bossDamageToday === "number");
    if (snapshot) snapshots.set(day.date, snapshot);
  }
  return snapshots;
}

function metricDelta(current, previous) {
  return typeof current === "number" && typeof previous === "number" ? current - previous : null;
}

function filterHistoryByRange(rows, range) {
  if (range === "all" || rows.length === 0) return rows;
  const days = range === "1m" ? 30 : 7;
  const latest = Math.max(...rows.map((row) => Date.parse(`${row.date}T00:00:00`)));
  const cutoff = range === "1w" ? startOfWeek(new Date(latest)).getTime() : latest - (days - 1) * 86_400_000;
  return rows.filter((row) => Date.parse(`${row.date}T00:00:00`) >= cutoff);
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(date) {
  return date.slice(5);
}

function findMemberFromRoute(route) {
  const key = decodeURIComponent(route.replace("member:", ""));
  return members.find((member) => memberKey(member) === key) ?? null;
}

function memberKey(member) {
  return member.playerId ?? member.rowId;
}

function setHashRoute(route) {
  window.location.hash = route;
}

function roleLabel(role) {
  return { leader: "Leader", officer: "Vice leader", elder: "Elder", member: "Member", boss: "Guild boss" }[role] ?? "Member";
}

function rowStateClass(evaluation) {
  if (evaluation.severity === "danger") return "row-danger";
  if (evaluation.severity === "warning") return "row-warning";
  if (evaluation.severity === "positive") return "row-positive";
  return "row-neutral";
}

function formatOptionalNumber(value) {
  return value == null ? "Not recorded" : formatNumber(value);
}

function formatOptionalCompact(value) {
  return value == null ? "Not recorded" : formatCompact(value);
}

function formatOptionalPower(value) {
  return value == null ? "Not recorded" : formatPowerDetail(value);
}

function formatOptionalBossDamage(value, fallbackText = null) {
  return value == null && !fallbackText ? "Not recorded" : formatBossDamageText(value, fallbackText);
}

function signedCompact(value) {
  if (value == null) return "Not recorded";
  return `${value >= 0 ? "+" : ""}${formatCompact(value)}`;
}

function signedNumber(value) {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function signedFormatted(value, formatter) {
  return `${value >= 0 ? "+" : ""}${formatter(value)}`;
}

function deltaDetail(value) {
  return typeof value === "number" ? `${signedNumber(value)} today` : "No previous snapshot";
}

function deltaLine(member) {
  const parts = [];
  if (typeof member.contributionDelta === "number") parts.push(`Donation ${signedNumber(member.contributionDelta)}`);
  if (typeof member.bossAttacksDelta === "number") parts.push(`MI tries ${signedNumber(member.bossAttacksDelta)}`);
  if (typeof member.powerDelta === "number") parts.push(`Power ${signedFormatted(member.powerDelta, formatCompact)}`);
  return parts.length > 0 ? parts.join(" · ") : "No previous snapshot";
}

function needDetail(flag, member, rules) {
  if (flag === "Missed boss") return `${member.bossAttacks ?? 0} boss tries recorded, below the ${rules.minBossTries} minimum.`;
  if (flag === "Low contribution") return `${formatNumber(member.contribution7d ?? 0)} donations, below the ${formatNumber(rules.minContribution7d)} rule.`;
  if (flag === "Game absence") return `Last activity is ${activityLabel(member.lastActivityDays)}.`;
  if (flag === "Low progression") return `${member.power14dPercent}% power growth over 14 days.`;
  if (flag === "Not in current guild") return "This record is kept for history but excluded from current guild metrics.";
  if (flag === "Excused absence") return member.absenceReason || "Officer-marked absence.";
  return flag;
}

function annotationValueKey(type) {
  return type === "warnings" ? "reason" : "note";
}

function todayLabel() {
  return currentImportDate();
}

function currentImportDate() {
  return (captures.lastImportedAt ?? captures.lastCapturedAt).slice(0, 10);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(value));
}

function normalizeRules(value) {
  const normalized = { ...value };
  if (typeof normalized.minBossTries !== "number") normalized.minBossTries = defaultRules.minBossTries;
  delete normalized.bossRequiredOnEventDay;
  return normalized;
}
