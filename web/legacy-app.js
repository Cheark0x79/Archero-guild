import { captures, changes, dailyRawSnapshots, guildRoster, memberSnapshots, ocrQueue, rules } from "./sample-data.js";
import {
  activityLabel,
  buildSummary,
  defaultSortDirection,
  evaluateMember,
  filterMembers,
  formatCompact,
  formatNumber,
  formatPowerDetail,
  lineChartPath,
  mergeRosterMetrics,
  newMemberDay as getNewMemberDay,
  sortMembers,
  topBy,
} from "./metrics.js";

const members = mergeRosterMetrics(guildRoster, memberSnapshots);
const RULES_STORAGE_KEY = "archero-observer-rules";
const editableRules = loadStoredRules();
const detailRanges = {
  progression: "1w",
  mi: "1w",
  donation: "1w",
};
const memberAnnotations = new Map(
  members.map((member) => [
    memberKey(member),
    {
      notes: [],
      warnings: [...(member.warnings ?? [])],
    },
  ]),
);

const routeMeta = {
  dashboard: ["Dashboard", "Operational view of contributions, progression, and alerts."],
  members: ["Members", "Search, status, and individual progression."],
  member: ["Member detail", "Daily history, progression, MI activity, notes, and warnings."],
  rankings: ["Rankings", "Top contribution, boss, and weekly progression."],
  activity: ["History", "Roster events, absences, and warnings."],
  ocr: ["OCR review", "Validation queue for uncertain OCR values."],
  settings: ["Rules", "Editable local thresholds before backend wiring."],
};

const pageTitle = document.querySelector("#page-title");
const pageSubtitle = document.querySelector("#page-subtitle");
const navLinks = [...document.querySelectorAll(".nav-list a")];
const views = [...document.querySelectorAll(".view")];
const sortButtons = [...document.querySelectorAll(".sort-button")];
const memberSort = {
  key: null,
  direction: "asc",
};

document.querySelector("#last-capture").textContent = formatDateTime(captures.lastCapturedAt);
document.querySelector("#refresh-button").addEventListener("click", () => {
  renderAll();
});

window.addEventListener("hashchange", syncRoute);
document.querySelector("#member-search").addEventListener("input", renderMembersTable);
document.querySelector("#status-filter").addEventListener("change", renderMembersTable);
document.querySelector("#members-table").addEventListener("click", (event) => {
  if (event.target.closest("a, button")) return;
  const row = event.target.closest("[data-member-row]");
  if (row) window.location.hash = `member:${encodeURIComponent(row.dataset.memberRow)}`;
});
document.querySelector("#member-detail").addEventListener("click", (event) => {
  const button = event.target.closest("[data-detail-range]");
  if (button) {
    detailRanges[button.dataset.detailChart] = button.dataset.detailRange;
    renderMemberDetail();
    return;
  }

  const actionButton = event.target.closest("[data-annotation-action]");
  if (!actionButton) return;
  const member = members.find((candidate) => memberKey(candidate) === actionButton.dataset.memberKey);
  if (!member) return;
  const annotations = getAnnotations(member);
  const collection = annotations[actionButton.dataset.annotationType];
  const index = Number(actionButton.dataset.annotationIndex);
  if (!collection || !Number.isInteger(index) || !collection[index]) return;

  if (actionButton.dataset.annotationAction === "delete") {
    collection.splice(index, 1);
  } else if (actionButton.dataset.annotationAction === "cancel") {
    delete collection[index].editing;
  } else {
    clearEditingFlags(collection);
    collection[index].editing = true;
  }
  renderMemberDetail();
});
sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (memberSort.key === key) {
      memberSort.direction = memberSort.direction === "asc" ? "desc" : "asc";
    } else {
      memberSort.key = key;
      memberSort.direction = defaultSortDirection(key);
    }
    renderMembersTable();
  });
});

renderAll();
syncRoute();

function renderAll() {
  renderSummary();
  renderCharts();
  renderWatchList();
  renderChanges();
  renderIdentityMetrics();
  renderMembersTable();
  renderRankings();
  renderActivity();
  renderOcr();
  renderRules();
  renderMemberDetail();
}

function syncRoute() {
  const route = window.location.hash.replace("#", "") || "dashboard";
  const activeRoute = route.startsWith("member:") ? "member" : routeMeta[route] ? route : "dashboard";
  const [title, subtitle] = routeMeta[activeRoute];
  const selectedMember = activeRoute === "member" ? findMemberFromRoute(route) : null;

  pageTitle.textContent = selectedMember ? selectedMember.name : title;
  pageSubtitle.textContent = selectedMember
    ? `${selectedMember.playerId ?? "Missing ID"} · ${roleLabel(selectedMember.role)} · ${activityLabel(selectedMember.lastActivityDays)}`
    : subtitle;

  navLinks.forEach((link) => {
    const navRoute = activeRoute === "member" ? "members" : activeRoute;
    link.classList.toggle("active", link.dataset.route === navRoute);
  });

  views.forEach((view) => {
    view.classList.toggle("active", view.id === `view-${activeRoute}`);
  });

  if (activeRoute === "member") renderMemberDetail();
}

function renderSummary() {
  const summary = buildSummary(members, editableRules);
  const cards = [
    ["Members", summary.members, `${summary.freeSlots} free slot(s), ${summary.formerMembers} former`],
    ["Known IDs", summary.knownIds, `${summary.unresolvedIds} missing`],
    ["Discord linked", summary.discordLinked, `${summary.discordMissing} missing / to verify`],
    ["Verified data", `${summary.verifiedMetrics}/${summary.currentMembers}`, `${summary.reviewRequired} need review`],
    ["Donation", formatNumber(summary.totalContribution), deltaDetail(summary.totalContributionDelta)],
    ["Boss tries", formatNumber(summary.bossAttacks), deltaDetail(summary.bossAttacksDelta)],
    ["Watch list", summary.watchCount, "Automatic rules"],
  ];

  document.querySelector("#summary-metrics").innerHTML = cards
    .map(
      ([label, value, detail]) => `
        <article class="metric-card">
          <span>${label}</span>
          <strong>${value}</strong>
          <small>${detail}</small>
        </article>
      `,
    )
    .join("");
}

function renderCharts() {
  document.querySelector("#contribution-chart").innerHTML = renderLineChart(
    captures.contribution30d,
    "Contribution",
    formatNumber(captures.contribution30d.at(-1)),
  );
  document.querySelector("#power-chart").innerHTML = renderLineChart(
    captures.averagePower8w,
    "Average power",
    formatCompact(captures.averagePower8w.at(-1)),
  );
}

function renderLineChart(values, label, currentValue) {
  const width = 720;
  const height = 230;
  const { line, area } = lineChartPath(values, width, height);
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}: ${currentValue}">
      <path class="chart-area" d="${area}"></path>
      <path class="chart-line" d="${line}"></path>
      <text class="chart-label" x="22" y="24">${label}</text>
      <text class="chart-label" x="${width - 22}" y="24" text-anchor="end">${currentValue}</text>
    </svg>
  `;
}

function renderWatchList() {
  const watched = members
    .map((member) => ({ member, evaluation: evaluateMember(member, editableRules) }))
    .filter(({ member, evaluation }) => member.metricsVerified && ["warning", "danger"].includes(evaluation.severity))
    .slice(0, 5);

  document.querySelector("#watch-list").innerHTML =
    watched.length === 0
      ? '<p class="muted">No verified alerts yet. Review captured metrics before applying rules.</p>'
      : watched
          .map(
            ({ member, evaluation }) => `
        <article class="watch-item">
          <header>
            <strong>${member.name}</strong>
            ${statusPill(evaluation.status, evaluation.severity)}
          </header>
          <span class="muted">${evaluation.flags.join(" · ")}</span>
          <span class="muted">${deltaLine(member)}</span>
        </article>
      `,
          )
          .join("");
}

function renderIdentityMetrics() {
  const summary = buildSummary(members, editableRules);
  const cards = [
    ["Current guild", `${summary.currentMembers} members`, `${summary.formerMembers} former record(s)`],
    ["Known IDs", summary.knownIds, `${summary.unresolvedIds} name(s) without ID`],
    ["Discord linked", `${summary.discordLinked} members`, `${summary.discordMissing} missing / to verify`],
    ["Verified metrics", `${summary.verifiedMetrics} members`, `${summary.reviewRequired} need review`],
  ];

  document.querySelector("#identity-metrics").innerHTML = cards
    .map(
      ([label, value, detail]) => `
        <article class="metric-card compact">
          <span>${label}</span>
          <strong>${value}</strong>
          <small>${detail}</small>
        </article>
      `,
    )
    .join("");
}

function renderChanges() {
  const html = changes.map(renderEvent).join("");
  document.querySelector("#changes-list").innerHTML = html;
  document.querySelector("#roster-events").innerHTML = html;
}

function renderEvent(event) {
  return `
    <article class="event-item">
      <header>
        <strong>${event.title}</strong>
        <span class="muted">${event.at}</span>
      </header>
      <span>${event.detail}</span>
    </article>
  `;
}

function renderMembersTable() {
  const query = document.querySelector("#member-search").value;
  const statusFilter = document.querySelector("#status-filter").value;
  const visibleMembers = sortMembers(filterMembers(members, editableRules, query, statusFilter), editableRules, memberSort);
  renderSortIndicators();

  document.querySelector("#members-table").innerHTML = visibleMembers
    .map((member) => {
      const evaluation = evaluateMember(member, editableRules);
      return `
        <tr class="member-row ${rowStateClass(evaluation)} clickable-row" data-member-row="${escapeHtml(memberKey(member))}">
          <td>
            <div class="player-cell">
              <strong>${member.playerId ?? "Missing ID"}</strong>
            </div>
          </td>
          <td>
            <a class="member-link" href="#member:${encodeURIComponent(memberKey(member))}">
              <strong>${member.name}</strong>
              ${newMemberBadge(member)}
            </a>
          </td>
          <td>${discordCell(member)}</td>
          <td>${roleLabel(member.role)}</td>
          <td>${activityLabel(member.lastActivityDays)}</td>
          <td class="numeric">${valueWithDelta(formatOptionalNumber(member.contribution7d), member.contributionDelta, formatNumber)}</td>
          <td class="numeric">${valueWithDelta(formatOptionalNumber(member.bossAttacks), member.bossAttacksDelta, formatNumber)}</td>
          <td class="numeric">${valueWithDelta(formatOptionalCompact(member.power), member.powerDelta, formatCompact)}</td>
          <td>${capturePill(member)}</td>
          <td>${statusPill(evaluation.status, evaluation.severity)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMemberDetail() {
  const route = window.location.hash.replace("#", "") || "dashboard";
  const member = route.startsWith("member:") ? findMemberFromRoute(route) : null;
  const container = document.querySelector("#member-detail");

  if (!member) {
    container.innerHTML = `
      <section class="panel">
        <p class="muted">Select a member from the Members table to open their detail view.</p>
      </section>
    `;
    return;
  }

  const evaluation = evaluateMember(member, editableRules);
  const history = dailyHistory(member);
  const weeklyHistory = filterHistoryByRange(history, "1w");
  const annotations = getAnnotations(member);
  const needs = memberNeeds(member, evaluation);

  container.innerHTML = `
    <div class="detail-actions">
      <a class="secondary-button" href="#members">Back to members</a>
      ${statusPill(evaluation.status, evaluation.severity)}
    </div>

    <div class="member-detail-grid">
      <section class="panel detail-hero">
        <div class="detail-title">
          <div>
            <h2>${escapeHtml(member.name)} ${newMemberBadge(member)}</h2>
            <p>${escapeHtml(member.playerId ?? "Missing ID")} · ${escapeHtml(roleLabel(member.role))}</p>
          </div>
          ${discordCell(member)}
        </div>
        <div class="detail-metrics">
          ${detailMetric("Power", formatOptionalCompact(member.power), member.powerDelta, formatCompact)}
          ${detailMetric("Donation", formatOptionalNumber(member.contribution7d), member.contributionDelta, formatNumber)}
          ${detailMetric("MI tries", formatOptionalNumber(member.bossAttacks), member.bossAttacksDelta, formatNumber)}
          ${detailMetric("Last activity", activityLabel(member.lastActivityDays), null, formatNumber)}
          ${detailMetric("Joined guild", joinedLabel(member), null, formatNumber)}
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Needs</h2>
            <p>Automatic checks against the current rules</p>
          </div>
        </div>
        <div class="need-list">
          ${
            needs.length === 0
              ? '<p class="muted">No current rule issue.</p>'
              : needs.map((need) => `<div class="need-row">${statusPill(need.label, need.severity)}<span>${escapeHtml(need.detail)}</span></div>`).join("")
          }
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Progression graph</h2>
            <p>Power from first captured snapshot to latest</p>
          </div>
          ${rangeSelector("progression")}
        </div>
        ${historyChart(filterHistoryByRange(history, detailRanges.progression), "power", formatPowerDetail, "No power history captured yet.")}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>MI damage graph</h2>
            <p>Guild boss damage from first captured snapshot to latest</p>
          </div>
          ${rangeSelector("mi")}
        </div>
        ${historyChart(filterHistoryByRange(history, detailRanges.mi), "bossDamage", formatNumber, "MI damage is not recorded in the current screenshots yet.")}
      </section>

      <section class="panel wide">
        <div class="panel-heading">
          <div>
            <h2>Daily history</h2>
            <p>One row per day in the current week. Missing captures stay visible as gaps.</p>
          </div>
        </div>
        ${historyTable(weeklyHistory)}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Donation history</h2>
            <p>Daily donation capture and delta</p>
          </div>
          ${rangeSelector("donation")}
        </div>
        ${donationHistoryTable(filterHistoryByRange(history, detailRanges.donation))}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>MI history</h2>
            <p>MI tries and damage, used to know if the member hit the guild boss</p>
          </div>
          ${rangeSelector("mi")}
        </div>
        ${miHistoryTable(filterHistoryByRange(history, detailRanges.mi))}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Warnings</h2>
            <p>Officer-tracked behavior issues</p>
          </div>
          <span class="status-pill neutral">${annotations.warnings.length}</span>
        </div>
        <form class="inline-form" data-member-warning="${escapeHtml(memberKey(member))}">
          <input name="reason" type="text" placeholder="Reason, e.g. attacked guildmates in arena" />
          <button class="primary-button" type="submit">Add warning</button>
        </form>
        <div class="event-list detail-list">
          ${annotationList(member, "warnings", annotations.warnings, "No warnings recorded for this member.")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Officer notes</h2>
            <p>Context that should affect moderation decisions</p>
          </div>
        </div>
        <form class="inline-form" data-member-note="${escapeHtml(memberKey(member))}">
          <input name="note" type="text" placeholder="Add a note or announced absence context" />
          <button class="primary-button" type="submit">Add note</button>
        </form>
        <div class="event-list detail-list">
          ${annotationList(member, "notes", annotations.notes, "No notes recorded for this member.")}
        </div>
      </section>
    </div>
  `;

  bindMemberDetailForms();
}

function renderSortIndicators() {
  sortButtons.forEach((button) => {
    const active = button.dataset.sort === memberSort.key;
    button.classList.toggle("active", active);
    button.classList.toggle("asc", active && memberSort.direction === "asc");
    button.classList.toggle("desc", active && memberSort.direction === "desc");
    button.setAttribute("aria-sort", active ? (memberSort.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function rowStateClass(evaluation) {
  if (evaluation.severity === "danger") return "row-danger";
  if (evaluation.severity === "warning") return "row-warning";
  if (evaluation.severity === "positive") return "row-positive";
  return "row-neutral";
}

function renderRankings() {
  const rankingGroups = [
    ["Top contribution", topBy(members, "contribution7d"), "contribution7d"],
    ["Top boss tries", topBy(members, "bossAttacks"), "bossAttacks"],
    ["Top progression", topBy(members, "power7d"), "power7d"],
  ];

  document.querySelector("#rankings-grid").innerHTML = rankingGroups
    .map(
      ([title, rows, key]) => `
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>${title}</h2>
              <p>Latest snapshot ranking</p>
            </div>
          </div>
          <div class="ranking-list">
            ${
              rows.length === 0
                ? '<p class="muted">No verified ranking data yet.</p>'
                : rows
                    .map(
                      (member, index) => `
                  <div class="ranking-row">
                    <span class="rank-number">${index + 1}</span>
                    <strong>${member.name}</strong>
                    <span>${key === "power7d" ? signedCompact(member[key]) : formatCompact(member[key])}</span>
                  </div>
                `,
                    )
                    .join("")
            }
          </div>
        </section>
      `,
    )
    .join("");
}

function renderActivity() {
  const currentMembers = members.filter((member) => !["inactive", "left", "kicked"].includes(member.status));
  const capturedMembers = currentMembers.filter((member) => member.metricsVerified);
  const maxContribution = Math.max(...capturedMembers.map((member) => member.contribution7d ?? 0), 1);
  const rows = [...currentMembers]
    .filter((member) => member.metricsVerified)
    .sort((a, b) => (b.contribution7d ?? 0) - (a.contribution7d ?? 0));

  document.querySelector("#member-bars").innerHTML =
    rows.length === 0
      ? '<p class="muted">No verified contribution data yet.</p>'
      : rows
          .map((member) => {
            const width = Math.max(2, ((member.contribution7d ?? 0) / maxContribution) * 100);
            return `
        <div class="bar-row">
          <strong>${member.name}</strong>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill" style="width: ${width}%"></div>
          </div>
          <span class="numeric">${formatNumber(member.contribution7d ?? 0)}</span>
        </div>
      `;
          })
          .join("");
  renderAbsenceList();
  renderWarningList();
}

function renderOcr() {
  document.querySelector("#ocr-count").textContent = `${ocrQueue.length} to review`;
  document.querySelector("#ocr-review").innerHTML =
    ocrQueue.length === 0
      ? `<article class="ocr-item">
          <strong>No OCR review items</strong>
          <span>This screen is empty because the current app is still using static sample data. Once the OCR worker writes low-confidence records, they will appear here with the source screenshot and suggested value.</span>
        </article>`
      : ocrQueue
          .map(
            (item) => `
        <article class="ocr-item">
          <header>
            <strong>${item.playerName} · ${item.field}</strong>
            ${statusPill(`${item.confidence}%`, item.confidence < 80 ? "danger" : "warning")}
          </header>
          <span>${item.reason}</span>
          <span class="muted">OCR: ${item.rawValue} · suggestion: ${item.suggestedValue}</span>
          <span class="muted">${item.screenshotPath}</span>
        </article>
      `,
          )
          .join("");
}

function renderRules() {
  const ruleRows = [
    ["maxInactiveDays", "Absent", "days without activity", "High alert", "number"],
    ["minContribution7d", "Watch", "minimum 7-day donation", "Medium alert", "number"],
    ["minPowerGrowth14dPercent", "Low progression", "minimum 14-day power growth %", "Medium alert", "number"],
    ["minBossTries", "Missed boss", "minimum boss tries per event day", "High alert", "number"],
    ["newMemberGraceDays", "New member", "grace period in days", "Rule pause"],
    ["memberCapacity", "Capacity", "guild member slots", "Free slot tracking", "number"],
  ];

  document.querySelector("#rules-grid").innerHTML = ruleRows
    .map(
      ([key, name, label, effect, type]) => `
        <section class="panel">
          <label class="rule-row">
            <strong>${name}</strong>
            <span>${label}</span>
            ${ruleInput(key, type)}
            <span class="muted">${effect}</span>
          </label>
        </section>
      `,
    )
    .join("");

  document.querySelectorAll("[data-rule]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.rule;
      editableRules[key] = input.type === "checkbox" ? input.checked : Number(input.value);
      saveStoredRules();
      renderAll();
    });
  });
}

function renderAbsenceList() {
  const absences = members.filter((member) => member.absenceUntil);
  document.querySelector("#absence-events").innerHTML =
    absences.length === 0
      ? '<p class="muted">No announced absences recorded yet.</p>'
      : absences
          .map(
            (member) => `
        <article class="event-item">
          <header>
            <strong>${member.name}</strong>
            <span class="muted">Until ${member.absenceUntil}</span>
          </header>
          <span>${member.absenceReason || "No reason recorded."}</span>
        </article>
      `,
          )
          .join("");
}

function renderWarningList() {
  const warnings = members.flatMap((member) =>
    getAnnotations(member).warnings.map((warning) => ({
      member,
      warning,
    })),
  );
  document.querySelector("#warning-events").innerHTML =
    warnings.length === 0
      ? '<p class="muted">No warnings recorded yet.</p>'
      : warnings
          .map(
            ({ member, warning }) => `
        <article class="event-item">
          <header>
            <strong>${member.name}</strong>
            <span class="muted">${warning.at ?? "No date"}</span>
          </header>
          <span>${warning.reason}</span>
        </article>
      `,
          )
          .join("");
}

function findMemberFromRoute(route) {
  const key = decodeURIComponent(route.replace("member:", ""));
  return members.find((member) => memberKey(member) === key) ?? null;
}

function memberKey(member) {
  return member.playerId ?? member.rowId;
}

function getAnnotations(member) {
  const key = memberKey(member);
  if (!memberAnnotations.has(key)) {
    memberAnnotations.set(key, { notes: [], warnings: [] });
  }
  return memberAnnotations.get(key);
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
  for (const day of dailyRawSnapshots) {
    const snapshot = day.rows?.find((row) => row.playerId === member.playerId);
    if (!snapshot) continue;
    const previous = rows.at(-1);
    rows.push({
      date: day.date,
      power: snapshot.power,
      powerDelta: metricDelta(snapshot.power, previous?.power),
      donation: snapshot.contribution7d,
      donationDelta: metricDelta(snapshot.contribution7d, previous?.donation),
      bossAttacks: snapshot.bossAttacks,
      bossAttacksDelta: metricDelta(snapshot.bossAttacks, previous?.bossAttacks),
      bossDamage: snapshot.bossDamageToday,
      activity: activityLabel(snapshot.lastActivityDays),
      source: snapshot.verificationNote || "Daily raw snapshot",
    });
  }
  return rows;
}

function metricDelta(current, previous) {
  return typeof current === "number" && typeof previous === "number" ? current - previous : null;
}

function memberNeeds(member, evaluation) {
  const needs = evaluation.flags.map((flag) => ({
    label: flag,
    severity: evaluation.severity,
    detail: needDetail(flag, member),
  }));

  if (needs.length > 0) return needs;

  return [];
}

function newMemberBadge(member) {
  const day = newMemberDay(member);
  return day == null ? "" : `<span class="new-member-tag">New +${day}j</span>`;
}

function newMemberDay(member) {
  return getNewMemberDay(member, editableRules);
}

function needDetail(flag, member) {
  if (flag === "Missed boss") return `${member.bossAttacks ?? 0} boss tries recorded for the current event day.`;
  if (flag === "Low contribution") return `${formatNumber(member.contribution7d ?? 0)} donations, below the ${formatNumber(editableRules.minContribution7d)} rule.`;
  if (flag === "Game absence") return `Last activity is ${activityLabel(member.lastActivityDays)}.`;
  if (flag === "Low progression") return `${member.power14dPercent}% power growth over 14 days.`;
  if (flag === "Not in current guild") return "This record is kept for history but excluded from current guild metrics.";
  if (flag === "Excused absence") return member.absenceReason || "Officer-marked absence.";
  return flag;
}

function historyTable(rows) {
  if (rows.length === 0) return '<p class="muted">No captured daily history for this member yet.</p>';

  return `
    <div class="table-wrap compact-table-wrap">
      <table class="detail-table">
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
          ${rows
            .map(
              (row) => `
            <tr>
              <td>${row.date}</td>
              <td>${valueWithDelta(formatOptionalPower(row.power), row.powerDelta, formatCompact)}</td>
              <td>${valueWithDelta(formatOptionalNumber(row.donation), row.donationDelta, formatNumber)}</td>
              <td>${valueWithDelta(formatOptionalNumber(row.bossAttacks), row.bossAttacksDelta, formatNumber)}</td>
              <td>${formatOptionalNumber(row.bossDamage)}</td>
              <td>${row.activity}</td>
              <td><span class="muted">${escapeHtml(row.source)}</span></td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function donationHistoryTable(rows) {
  if (rows.length === 0) return '<p class="muted">No donation history captured yet.</p>';

  return `
    <div class="table-wrap compact-table-wrap">
      <table class="detail-table compact-history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Donation</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${row.date}</td>
                  <td>${formatOptionalNumber(row.donation)}</td>
                  <td>${typeof row.donationDelta === "number" ? signedNumber(row.donationDelta) : "Not recorded"}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function miHistoryTable(rows) {
  if (rows.length === 0) return '<p class="muted">No MI history captured yet.</p>';

  return `
    <div class="table-wrap compact-table-wrap">
      <table class="detail-table compact-history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>MI tries</th>
            <th>MI damage</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${row.date}</td>
                  <td>${formatOptionalNumber(row.bossAttacks)}</td>
                  <td>${formatOptionalNumber(row.bossDamage)}</td>
                  <td>${typeof row.bossAttacks === "number" ? miStatus(row) : "Not recorded"}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function filterHistoryByRange(rows, range) {
  if (range === "all" || rows.length === 0) return rows;
  const days = range === "1m" ? 30 : 7;
  const latest = Math.max(...rows.map((row) => Date.parse(`${row.date}T00:00:00`)));
  const cutoff = range === "1w" ? startOfWeek(new Date(latest)).getTime() : latest - (days - 1) * 86_400_000;
  const filtered = rows.filter((row) => Date.parse(`${row.date}T00:00:00`) >= cutoff);
  return range === "1w" ? fillHistoryDateSlots(filtered, new Date(cutoff), days) : filtered;
}

function fillHistoryDateSlots(rows, startDate, days) {
  const rowsByDate = new Map(rows.map((row) => [row.date, row]));
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(startDate, index);
    const dateLabel = formatLocalDate(date);
    return rowsByDate.get(dateLabel) ?? emptyHistoryRow(dateLabel);
  });
}

function emptyHistoryRow(date) {
  return {
    date,
    power: null,
    powerDelta: null,
    donation: null,
    donationDelta: null,
    bossAttacks: null,
    bossAttacksDelta: null,
    bossDamage: null,
    activity: "Not recorded",
    source: "No screenshot captured",
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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

function rangeSelector(chart) {
  const options = [
    ["1w", "1W"],
    ["1m", "1M"],
    ["all", "All"],
  ];
  return `
    <div class="range-selector" aria-label="Chart range">
      ${options
        .map(
          ([value, label]) => `
            <button class="${detailRanges[chart] === value ? "active" : ""}" type="button" data-detail-chart="${chart}" data-detail-range="${value}">${label}</button>
          `,
        )
        .join("")}
    </div>
  `;
}

function historyChart(rows, key, formatter, emptyText) {
  const points = rows
    .map((row, index) => ({
      date: row.date,
      value: row[key],
      slotIndex: index,
    }))
    .filter((point) => typeof point.value === "number");

  if (points.length === 0) {
    return `<div class="chart-empty">${emptyText}</div>`;
  }

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

  return `
    <div class="detail-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${formatter(latest.value)} on ${latest.date}">
        <path class="chart-grid-line" d="M ${padding} ${height - padding} L ${width - padding} ${height - padding}"></path>
        ${rows
          .map((row, index) => {
            const x = rows.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (rows.length - 1);
            return `
              <g>
                <path class="chart-tick-line" d="M ${x.toFixed(1)} ${height - padding - 4} L ${x.toFixed(1)} ${height - padding + 4}"></path>
                ${!valueDates.has(row.date) ? `<circle class="chart-missing-point" cx="${x.toFixed(1)}" cy="${height - padding}" r="3"></circle>` : ""}
                <text class="chart-axis-label" x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle">${formatShortDate(row.date)}</text>
              </g>
            `;
          })
          .join("")}
        ${coordinates.length > 1 ? `<path class="chart-area" d="${line} L ${latest.x.toFixed(1)} ${height - padding} L ${coordinates[0].x.toFixed(1)} ${height - padding} Z"></path>` : ""}
        <path class="chart-line" d="${line}"></path>
        ${coordinates.map((point) => `<circle class="chart-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5"></circle>`).join("")}
        ${coordinates.map((point, index) => `<text class="chart-value-label" x="${point.x.toFixed(1)}" y="${chartValueLabelY(point, index).toFixed(1)}" text-anchor="middle">${formatter(point.value)}</text>`).join("")}
        <text class="chart-label" x="${padding}" y="24">${rows[0]?.date ?? points[0].date}</text>
        <text class="chart-label" x="${width - padding}" y="24" text-anchor="end">${rows.at(-1)?.date ?? latest.date}</text>
      </svg>
    </div>
  `;
}

function chartValueLabelY(point, index) {
  return Math.max(18, point.y - 12 - (index % 2) * 8);
}

function progressionTable(rows) {
  if (rows.length === 0) return '<p class="muted">No progression capture yet.</p>';
  const row = rows[0];
  const powerState = row.powerDelta > 0 ? "Progress recorded" : "No progression recorded";

  return `
    <div class="stat-list">
      <div><span class="muted">Current power</span><strong>${formatOptionalCompact(row.power)}</strong></div>
      <div><span class="muted">Captured gain</span><strong>${signedCompact(row.powerDelta ?? 0)}</strong></div>
      <div><span class="muted">Scaling read</span><strong>${powerState}</strong></div>
      <div><span class="muted">Weekly trend</span><strong>Pending more snapshots</strong></div>
    </div>
  `;
}

function bossTable(rows) {
  if (rows.length === 0) return '<p class="muted">No MI capture yet.</p>';
  const row = rows[0];

  return `
    <div class="stat-list">
      <div><span class="muted">Current MI tries</span><strong>${formatOptionalNumber(row.bossAttacks)}</strong></div>
      <div><span class="muted">Today delta</span><strong>${signedNumber(row.bossAttacksDelta ?? 0)}</strong></div>
      <div><span class="muted">MI damage</span><strong>${formatOptionalNumber(row.bossDamage)}</strong></div>
      <div><span class="muted">Status</span><strong>${row.bossAttacks >= editableRules.minBossTries ? "Complete" : "Incomplete"}</strong></div>
    </div>
  `;
}

function miStatus(row) {
  return row.bossAttacks >= editableRules.minBossTries ? "Complete" : "Incomplete";
}

function joinedLabel(member) {
  return member.joinedAt ?? "Not recorded";
}

function detailMetric(label, valueHtml, delta, formatter) {
  return `
    <div class="detail-metric">
      <span>${label}</span>
      <strong>${valueHtml}</strong>
      ${typeof delta === "number" ? `<small class="delta ${delta > 0 ? "positive" : "neutral"}">+${formatter(delta)}</small>` : ""}
    </div>
  `;
}

function annotationList(member, type, items, emptyText) {
  if (items.length === 0) return `<p class="muted">${emptyText}</p>`;
  return items
    .map((item, index) => annotationItem(member, type, item, index))
    .join("");
}

function annotationItem(member, type, item, index) {
  const key = type === "warnings" ? "reason" : "note";
  const value = item[key] ?? "";
  if (item.editing) {
    return `
      <article class="event-item annotation-item">
        <form class="inline-form" data-member-annotation-edit="${escapeHtml(memberKey(member))}" data-annotation-type="${type}" data-annotation-index="${index}">
          <input name="value" type="text" value="${escapeHtml(value)}" />
          <button class="primary-button" type="submit">Save</button>
          <button class="secondary-button" type="button" data-annotation-action="cancel" data-member-key="${escapeHtml(memberKey(member))}" data-annotation-type="${type}" data-annotation-index="${index}">Cancel</button>
        </form>
      </article>
    `;
  }

  return `
    <article class="event-item annotation-item">
      <header>
        <strong>${escapeHtml(value || "Entry")}</strong>
        <span class="muted">${escapeHtml(item.at ?? "Today")}</span>
      </header>
      <div class="annotation-actions">
        <button class="secondary-button compact-action" type="button" data-annotation-action="edit" data-member-key="${escapeHtml(memberKey(member))}" data-annotation-type="${type}" data-annotation-index="${index}">Edit</button>
        <button class="secondary-button compact-action danger-action" type="button" data-annotation-action="delete" data-member-key="${escapeHtml(memberKey(member))}" data-annotation-type="${type}" data-annotation-index="${index}">Delete</button>
      </div>
    </article>
  `;
}

function annotationValueKey(type) {
  return type === "warnings" ? "reason" : "note";
}

function clearEditingFlags(items) {
  items.forEach((item) => {
    delete item.editing;
  });
}

function handleAnnotationEdit(form) {
  const member = members.find((candidate) => memberKey(candidate) === form.dataset.memberAnnotationEdit);
  if (!member) return;
  const annotations = getAnnotations(member);
  const type = form.dataset.annotationType;
  const items = annotations[type];
  const index = Number(form.dataset.annotationIndex);
  const value = new FormData(form).get("value")?.toString().trim();
  if (!items || !Number.isInteger(index) || !items[index] || !value) return;
  items[index][annotationValueKey(type)] = value;
  delete items[index].editing;
}

function bindMemberDetailForms() {
  document.querySelectorAll("[data-member-warning]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const member = members.find((candidate) => memberKey(candidate) === form.dataset.memberWarning);
      const value = new FormData(form).get("reason")?.toString().trim();
      if (!member || !value) return;
      getAnnotations(member).warnings.unshift({ reason: value, at: todayLabel() });
      renderAll();
    });
  });

  document.querySelectorAll("[data-member-note]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const member = members.find((candidate) => memberKey(candidate) === form.dataset.memberNote);
      const value = new FormData(form).get("note")?.toString().trim();
      if (!member || !value) return;
      getAnnotations(member).notes.unshift({ note: value, at: todayLabel() });
      renderAll();
    });
  });

  document.querySelectorAll("[data-member-annotation-edit]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAnnotationEdit(form);
      renderAll();
    });
  });
}

function statusPill(label, severity) {
  return `<span class="status-pill ${severity}">${label}</span>`;
}

function capturePill(member) {
  if (["inactive", "left", "kicked"].includes(member.status)) return '<span class="muted">Former</span>';
  if (!member.playerId) return '<span class="muted">Missing ID</span>';
  if (!member.lastSeenAt) return '<span class="muted">Not seen</span>';
  return `<time datetime="${escapeHtml(member.lastSeenAt)}">${escapeHtml(member.lastSeenAt)}</time>`;
}

function discordCell(member) {
  const label = member.discordLinked ? "Member is on Discord" : "Member is not linked on Discord";
  const className = member.discordLinked ? "linked" : "missing";
  return `
    <span class="discord-dot ${className}" title="${label}" aria-label="${label}">
      <span class="sr-only">${label}</span>
    </span>
  `;
}

function roleLabel(role) {
  const labels = {
    leader: "Leader",
    officer: "Vice leader",
    elder: "Elder",
    member: "Member",
  };
  return labels[role] ?? "Member";
}

function signedCompact(value) {
  if (value == null) return "Not recorded";
  return `${value >= 0 ? "+" : ""}${formatCompact(value)}`;
}

function signedNumber(value) {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function deltaDetail(value) {
  if (typeof value !== "number") return "No previous snapshot";
  return `<span class="delta positive">+${formatNumber(value)}</span> today`;
}

function valueWithDelta(valueHtml, delta, formatter) {
  if (typeof delta !== "number") return valueHtml;
  const className = delta > 0 ? "positive" : "neutral";
  return `<span class="value-stack"><span>${valueHtml}</span><span class="delta ${className}">+${formatter(delta)}</span></span>`;
}

function deltaLine(member) {
  const parts = [];
  if (typeof member.contributionDelta === "number") parts.push(`Donation +${formatNumber(member.contributionDelta)}`);
  if (typeof member.bossAttacksDelta === "number") parts.push(`MI tries +${formatNumber(member.bossAttacksDelta)}`);
  if (typeof member.powerDelta === "number") parts.push(`Power +${formatCompact(member.powerDelta)}`);
  return parts.length > 0 ? parts.join(" · ") : "No previous snapshot";
}

function ruleInput(key, type) {
  if (type === "checkbox") {
    return `<input class="rule-checkbox" type="checkbox" ${editableRules[key] ? "checked" : ""} data-rule="${key}" />`;
  }

  return `<input class="rule-input" type="number" min="0" step="${key === "minPowerGrowth14dPercent" ? "0.1" : "1"}" value="${editableRules[key]}" data-rule="${key}" />`;
}

function loadStoredRules() {
  const stored = readStoredRules();
  return normalizeRules({
    ...rules,
    ...stored,
    currentDate: captures.lastCapturedAt.slice(0, 10),
  });
}

function readStoredRules() {
  try {
    return JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveStoredRules() {
  const { currentDate, ...persistedRules } = editableRules;
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(persistedRules));
}

function normalizeRules(value) {
  const normalized = { ...value };
  if (typeof normalized.minBossTries !== "number") {
    normalized.minBossTries = rules.minBossTries;
  }
  delete normalized.bossRequiredOnEventDay;
  return normalized;
}

function formatOptionalNumber(value) {
  return value == null ? '<span class="muted">Not recorded</span>' : formatNumber(value);
}

function formatOptionalCompact(value) {
  return value == null ? '<span class="muted">Not recorded</span>' : formatCompact(value);
}

function formatOptionalPower(value) {
  return value == null ? '<span class="muted">Not recorded</span>' : formatPowerDetail(value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function todayLabel() {
  return currentImportDate();
}

function currentImportDate() {
  return (captures.lastImportedAt ?? captures.lastCapturedAt).slice(0, 10);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
