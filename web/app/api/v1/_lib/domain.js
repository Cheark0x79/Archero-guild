import { buildSummary, evaluateMember, mergeRosterMetrics } from "../../../../metrics.js";
import { bossDefinitionFromSnapshot, bossRankingsFromData } from "../../dashboard-data/source.js";
import { evaluateWarningHistory, warningHistoryEvents, warningHistorySummary } from "../../../../warning-history.js";
import { warningActionKey } from "../../../../lib/warning-actions.js";
import { createMemberShareCode } from "../../../../lib/share-links.js";
import { utcTimestamp } from "./metadata.js";
import { absolutePublicUrl } from "./urls.js";

const FORMER_STATUSES = new Set(["inactive", "left", "kicked"]);
const ALLOWED_MEMBER_STATUSES = new Set(["active", "former", "all"]);
const RANKING_METRICS = new Set(["power", "contribution7d", "powerDelta", "contributionDelta", "bossAttacks", "activity"]);
const WARNING_TYPES = new Set(["game_absence", "low_contribution", "low_progression", "missed_boss"]);
const WARNING_RULE_KEYS = ["maxInactiveDays", "minContribution7d", "minPowerGrowth14dPercent", "minBossTries"];

export function membersFromData(data, publicOrigin = "") {
  return mergeRosterMetrics(data.guildRoster ?? [], data.memberSnapshots ?? [])
    .map((member) => publicMember(member, data.rules ?? {}, publicOrigin));
}

export function publicMember(member, rules, publicOrigin = "") {
  const evaluation = evaluateMember(member, rules);
  return {
    playerId: member.playerId,
    name: member.name,
    role: member.role,
    guildStatus: member.status,
    discordLinked: member.discordLinked,
    joinedAt: member.joinedAt,
    leftAt: member.leftAt,
    lastSeenAt: member.lastSeenAt,
    metrics: {
      power: member.power,
      powerDelta: member.powerDelta,
      contribution7d: member.contribution7d,
      contributionDelta: member.contributionDelta,
      bossAttacks: member.bossAttacks,
      lastActivityDays: member.lastActivityDays,
      captured: member.metricsCaptured,
      verified: member.metricsVerified,
    },
    evaluation: {
      status: evaluation.status,
      severity: evaluation.severity,
      flags: evaluation.flags,
    },
    links: member.playerId
      ? {
          api: absolutePublicUrl(`/api/v1/members/${encodeURIComponent(member.playerId)}`, publicOrigin),
          web: sharedMemberWebUrl(member.playerId, publicOrigin),
        }
      : null,
  };
}

export function resolveMemberFromData(data, searchParams, publicOrigin = "") {
  const query = searchParams.get("q")?.trim();
  const limit = integerParameter(searchParams.get("limit"), 5, 1, 10);
  if (!query) return { error: { code: "missing_query", message: "q is required." } };
  if (limit === null) return { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 10." } };

  const normalizedQuery = normalizeCompact(query);
  const candidates = mergeRosterMetrics(data.guildRoster ?? [], data.memberSnapshots ?? [])
    .filter((member) => member.playerId && !FORMER_STATUSES.has(member.status))
    .map((member) => bestMemberMatch(member, query, normalizedQuery, publicOrigin))
    .filter((match) => match.confidence >= 0.5)
    .sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name))
    .slice(0, limit);

  const unambiguous = candidates[0] && (
    candidates[0].confidence === 1 ||
    !candidates[1] ||
    candidates[0].confidence - candidates[1].confidence >= 0.12
  );
  return {
    query,
    match: unambiguous ? candidates[0] : null,
    suggestions: unambiguous ? candidates.slice(1) : candidates,
  };
}

export function guildSummaryFromData(data) {
  const members = mergeRosterMetrics(data.guildRoster ?? [], data.memberSnapshots ?? []);
  return {
    ...buildSummary(members, data.rules ?? {}),
    lastCapturedAt: utcTimestamp(data.captures?.lastCapturedAt),
    lastImportedAt: utcTimestamp(data.captures?.lastImportedAt),
  };
}

export function rulesFromData(data) {
  const rules = data.rules ?? {};
  return {
    maxInactiveDays: rules.maxInactiveDays ?? null,
    minContribution7d: rules.minContribution7d ?? null,
    minPowerGrowth14dPercent: rules.minPowerGrowth14dPercent ?? null,
    minBossTries: rules.minBossTries ?? null,
    newMemberGraceDays: rules.newMemberGraceDays ?? null,
    memberCapacity: rules.memberCapacity ?? null,
  };
}

export function violationsFromData(data, searchParams) {
  const rulesError = warningRulesError(data);
  if (rulesError) return { error: rulesError };
  const type = searchParams.get("type");
  if (type && !WARNING_TYPES.has(type)) {
    return { error: { code: "invalid_warning_type", message: `type must be one of: ${[...WARNING_TYPES].join(", ")}.` } };
  }
  const from = dateParameter(searchParams.get("from"));
  const to = dateParameter(searchParams.get("to"));
  const historyLimit = integerParameter(searchParams.get("limit"), 200, 1, 1000);
  if (from === false || to === false) {
    return { error: { code: "invalid_date", message: "from and to must use YYYY-MM-DD format." } };
  }
  if (from && to && from > to) {
    return { error: { code: "invalid_date_range", message: "from must be earlier than or equal to to." } };
  }
  if (historyLimit === null) {
    return { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 1000." } };
  }
  const flag = normalize(searchParams.get("flag"));
  const playerId = searchParams.get("playerId")?.trim();
  const items = membersFromData(data)
    .map((member) => effectiveViolationMember(data, member))
    .filter((member) => !FORMER_STATUSES.has(member.guildStatus))
    .filter((member) => ["warning", "danger"].includes(member.evaluation.severity))
    .filter((member) => !playerId || member.playerId === playerId)
    .filter((member) => !type || member.evaluation.flags.some((item) => warningTypeForFlag(item) === type))
    .filter((member) => !flag || member.evaluation.flags.some((item) => normalize(item).includes(flag)))
    .map(compactWarningMember)
    .sort((left, right) => left.name.localeCompare(right.name));
  const allHistory = (data.guildRoster ?? [])
    .filter((member) => member.playerId)
    .filter((member) => !playerId || member.playerId === playerId)
    .flatMap((member) =>
      memberWarningEvents(data, member.playerId)
        .filter((event) => !from || event.date >= from)
        .filter((event) => !to || event.date <= to)
        .filter((event) => !type || event.type === type)
        .filter((event) => !flag || normalize(event.label).includes(flag))
        .map((event) => ({
          ...withoutWarningSeverity(event),
          playerId: member.playerId,
          name: member.name,
          action: warningAction(data, member.playerId, event),
        })),
    )
    .sort((left, right) => right.date.localeCompare(left.date) || left.name.localeCompare(right.name));
  return {
    items,
    summary: violationSummary(items),
    warningSummary: warningEventSummary(allHistory),
    history: allHistory.slice(0, historyLimit),
    historyPagination: {
      limit: historyLimit,
      totalWarnings: allHistory.length,
      hasMore: allHistory.length > historyLimit,
    },
  };
}

export function warningsFromData(data, searchParams) {
  const rulesError = warningRulesError(data);
  if (rulesError) return { error: rulesError };
  const query = warningQuery(searchParams, { defaultLimit: 200, maximumLimit: 1000 });
  if (query.error) return query;

  const latestDates = latestSnapshotDates(data);
  const events = warningEventsForData(data)
    .filter((event) => !query.playerId || event.playerId === query.playerId)
    .filter((event) => !query.type || event.type === query.type)
    .filter((event) => !query.from || event.date >= query.from)
    .filter((event) => !query.to || event.date <= query.to)
    .filter((event) => query.scope !== "current" || latestDates.get(event.playerId) === event.date)
    .sort((left, right) => right.date.localeCompare(left.date) || left.name.localeCompare(right.name));

  return {
    scope: query.scope,
    type: query.type,
    summary: warningEventSummary(events),
    warnings: events.slice(0, query.limit).map(withoutWarningSeverity),
    pagination: {
      limit: query.limit,
      totalWarnings: events.length,
      hasMore: events.length > query.limit,
    },
  };
}

export function warningRankingsFromData(data, searchParams) {
  const rulesError = warningRulesError(data);
  if (rulesError) return { error: rulesError };
  const query = warningQuery(searchParams, {
    defaultLimit: 10,
    maximumLimit: 100,
    allowPlayerId: false,
    defaultScope: "history",
  });
  if (query.error) return query;
  const order = searchParams.get("order") ?? "desc";
  if (!["asc", "desc"].includes(order)) {
    return { error: { code: "invalid_order", message: "order must be asc or desc." } };
  }

  const latestDates = latestSnapshotDates(data);
  const events = warningEventsForData(data)
    .filter((event) => !warningActionClosed(event.action?.status))
    .filter((event) => !query.type || event.type === query.type)
    .filter((event) => !query.from || event.date >= query.from)
    .filter((event) => !query.to || event.date <= query.to)
    .filter((event) => query.scope !== "current" || latestDates.get(event.playerId) === event.date);
  const grouped = new Map();
  for (const event of events) {
    const current = grouped.get(event.playerId) ?? {
      playerId: event.playerId,
      name: event.name,
      totalWarnings: 0,
      warningCountsByType: {},
      lastWarningAt: null,
    };
    current.totalWarnings += 1;
    current.warningCountsByType[event.type] = (current.warningCountsByType[event.type] ?? 0) + 1;
    if (!current.lastWarningAt || event.date > current.lastWarningAt) current.lastWarningAt = event.date;
    grouped.set(event.playerId, current);
  }
  const rows = [...grouped.values()]
    .sort((left, right) => {
      const totalDifference = order === "asc"
        ? left.totalWarnings - right.totalWarnings
        : right.totalWarnings - left.totalWarnings;
      return totalDifference || left.name.localeCompare(right.name);
    })
    .slice(0, query.limit)
    .map((row, index) => ({ rank: index + 1, ...row }));
  return {
    totalMembers: grouped.size,
    rankings: rows,
  };
}

export function memberWarningsFromData(data, playerId, searchParams) {
  const query = new URLSearchParams(searchParams);
  query.set("playerId", playerId);
  if (!query.has("scope")) query.set("scope", "history");
  const result = warningsFromData(data, query);
  if (result.error) return result;
  const member = (data.guildRoster ?? []).find((row) => row.playerId === playerId);
  return {
    playerId,
    name: member?.name ?? playerId,
    summary: result.summary,
    warnings: result.warnings.map(compactMemberWarning),
    pagination: result.pagination,
  };
}

export function memberRankingsFromData(data, searchParams, publicOrigin = "") {
  const metric = searchParams.get("metric") ?? "power";
  const order = searchParams.get("order") ?? (metric === "activity" ? "asc" : "desc");
  const limit = integerParameter(searchParams.get("limit"), 10, 1, 100);
  if (!RANKING_METRICS.has(metric)) {
    return { error: { code: "invalid_metric", message: `metric must be one of: ${[...RANKING_METRICS].join(", ")}.` } };
  }
  if (!["asc", "desc"].includes(order)) {
    return { error: { code: "invalid_order", message: "order must be asc or desc." } };
  }
  if (limit === null) return { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 100." } };
  const rankedMembers = membersFromData(data, publicOrigin)
    .filter((member) => !FORMER_STATUSES.has(member.guildStatus) && member.metrics.verified)
    .map((member) => ({ ...member, value: rankingValue(member, metric) }))
    .filter((member) => typeof member.value === "number")
    .sort((left, right) => rankingComparator(left, right, metric, order));
  const total = rankedMembers.length;
  const rows = rankedMembers
    .slice(0, limit)
    .map((member, index) => ({
      rank: rankingPosition(index, total, metric, order),
      playerId: member.playerId,
      name: member.name,
      role: member.role,
      value: member.value,
      ...(metric === "contribution7d" ? { belowMinimum: member.value < (data.rules?.minContribution7d ?? 0) } : {}),
      lastSeenAt: member.lastSeenAt,
      links: member.links,
    }));
  return { metric, order, total, items: rows };
}

export function memberHistoryFromData(data, playerId, searchParams) {
  const from = dateParameter(searchParams.get("from"));
  const to = dateParameter(searchParams.get("to"));
  if (from === false || to === false) {
    return { error: { code: "invalid_date", message: "from and to must use YYYY-MM-DD format." } };
  }
  if (from && to && from > to) {
    return { error: { code: "invalid_date_range", message: "from must be earlier than or equal to to." } };
  }
  const name = (data.guildRoster ?? []).find((member) => member.playerId === playerId)?.name ?? playerId;
  const rawItems = (data.dailyRawSnapshots ?? [])
    .flatMap((day) => (day.rows ?? []).filter((row) => row.playerId === playerId).map((row) => ({
      date: day.date,
      power: row.power ?? null,
      contribution7d: row.contribution7d ?? null,
      bossAttacks: row.bossAttacks ?? null,
      lastActivityDays: row.lastActivityDays ?? null,
      activityText: row.activityText ?? null,
    })))
    .sort((left, right) => left.date.localeCompare(right.date));
  const rosterMember = (data.guildRoster ?? []).find((member) => member.playerId === playerId) ?? {};
  const items = evaluateWarningHistory(rawItems, data.rules ?? {}, rosterMember)
    .filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
  const warningEvents = items.flatMap((row) =>
    row.warnings.map((warning) => ({
      ...warning,
      date: row.date,
      id: `${row.date}:${warning.type}`,
      action: warningAction(data, playerId, { ...warning, date: row.date }),
    })),
  );
  const enrichedItems = items.map((row) => ({
    ...row,
    warnings: row.warnings.map((warning) => ({
      ...withoutWarningSeverity(warning),
      action: warningAction(data, playerId, { ...warning, date: row.date }),
    })),
  }));
  return {
    playerId,
    name,
    items: enrichedItems,
    warningSummary: warningHistorySummary(warningEvents),
  };
}

function memberWarningEvents(data, playerId) {
  const member = (data.guildRoster ?? []).find((row) => row.playerId === playerId) ?? {};
  const rows = (data.dailyRawSnapshots ?? [])
    .flatMap((day) =>
      (day.rows ?? [])
        .filter((row) => row.playerId === playerId)
        .map((row) => ({
          date: day.date,
          power: row.power ?? null,
          contribution7d: row.contribution7d ?? null,
          bossAttacks: row.bossAttacks ?? null,
          lastActivityDays: row.lastActivityDays ?? null,
        })),
    );
  return warningHistoryEvents(rows, data.rules ?? {}, member);
}

function warningEventsForData(data) {
  return (data.guildRoster ?? [])
    .filter((member) => member.playerId && !FORMER_STATUSES.has(member.status))
    .flatMap((member) =>
      memberWarningEvents(data, member.playerId).map((event) => ({
        ...event,
        playerId: member.playerId,
        name: member.name,
        action: warningAction(data, member.playerId, event),
      })),
    );
}

function latestSnapshotDates(data) {
  const dates = new Map();
  for (const day of data.dailyRawSnapshots ?? []) {
    for (const row of day.rows ?? []) {
      if (!row.playerId) continue;
      const current = dates.get(row.playerId);
      if (!current || day.date > current) dates.set(row.playerId, day.date);
    }
  }
  return dates;
}

function warningRulesError(data) {
  const missing = WARNING_RULE_KEYS.filter((key) => typeof data.rules?.[key] !== "number");
  return missing.length > 0
    ? {
        status: 503,
        code: "rules_not_configured",
        message: `Warning evaluation requires configured rules: ${missing.join(", ")}.`,
      }
    : null;
}

function warningQuery(searchParams, options) {
  const type = searchParams.get("type");
  const scope = searchParams.get("scope") ?? options.defaultScope ?? "current";
  const from = dateParameter(searchParams.get("from"));
  const to = dateParameter(searchParams.get("to"));
  const limit = integerParameter(searchParams.get("limit"), options.defaultLimit, 1, options.maximumLimit);
  const playerId = options.allowPlayerId === false ? null : searchParams.get("playerId")?.trim();
  if (type && !WARNING_TYPES.has(type)) {
    return { error: { code: "invalid_warning_type", message: `type must be one of: ${[...WARNING_TYPES].join(", ")}.` } };
  }
  if (!["current", "history"].includes(scope)) {
    return { error: { code: "invalid_scope", message: "scope must be current or history." } };
  }
  if (from === false || to === false) {
    return { error: { code: "invalid_date", message: "from and to must use YYYY-MM-DD format." } };
  }
  if (from && to && from > to) {
    return { error: { code: "invalid_date_range", message: "from must be earlier than or equal to to." } };
  }
  if (limit === null) {
    return { error: { code: "invalid_limit", message: `limit must be an integer between 1 and ${options.maximumLimit}.` } };
  }
  return { type, scope, from, to, limit, playerId };
}

function warningEventSummary(events) {
  const warningCountsByType = {};
  let lastWarningAt = null;
  for (const event of events) {
    warningCountsByType[event.type] = (warningCountsByType[event.type] ?? 0) + 1;
    if (!lastWarningAt || event.date > lastWarningAt) lastWarningAt = event.date;
  }
  return { totalWarnings: events.length, warningCountsByType, lastWarningAt };
}

function withoutWarningSeverity(event) {
  const { severity: _severity, ...warning } = event;
  return warning;
}

function compactMemberWarning(event) {
  return {
    date: event.date,
    type: event.type,
    label: event.label,
    value: event.value,
    threshold: event.threshold,
    ...(event.baselineDate ? { baselineDate: event.baselineDate } : {}),
  };
}

function compactWarningMember(member) {
  return {
    playerId: member.playerId,
    name: member.name,
    lastSeenAt: member.lastSeenAt,
    evaluation: {
      status: member.evaluation.status,
      warnings: member.evaluation.flags.map((label) => ({
        type: warningTypeForFlag(label),
        label,
      })),
    },
  };
}

function warningAction(data, playerId, event) {
  const action = data.warningActions?.[warningActionKey(playerId, event.date, event.type)];
  return action ? { ...action, updatedAt: utcTimestamp(action.updatedAt) } : {
    status: "pending",
    note: "",
    updatedAt: null,
  };
}

function effectiveViolationMember(data, member) {
  if (!member.playerId || !member.evaluation.flags.length) return member;
  const latestDate = (data.dailyRawSnapshots ?? [])
    .filter((day) => (day.rows ?? []).some((row) => row.playerId === member.playerId))
    .map((day) => day.date)
    .sort()
    .at(-1);
  if (!latestDate) return member;
  const flags = member.evaluation.flags.filter((flag) => {
    const type = warningTypeForFlag(flag);
    if (!type) return true;
    const action = data.warningActions?.[warningActionKey(member.playerId, latestDate, type)];
    return !warningActionClosed(action?.status);
  });
  if (flags.length === member.evaluation.flags.length) return member;
  return {
    ...member,
    evaluation: flags.length > 0
      ? { ...member.evaluation, flags }
      : { status: "Active", severity: "positive", flags: [] },
  };
}

function warningTypeForFlag(flag) {
  return {
    "Game absence": "game_absence",
    "Low contribution": "low_contribution",
    "Low progression": "low_progression",
    "Missed boss": "missed_boss",
  }[flag] ?? null;
}

export function bossDaysFromData(data, searchParams) {
  const date = dateParameter(searchParams.get("date"));
  const boss = searchParams.get("boss");
  const playerId = searchParams.get("playerId");
  const limit = integerParameter(searchParams.get("limit"), 100, 1, 100);
  if (date === false) return { error: { code: "invalid_date", message: "date must use YYYY-MM-DD format." } };
  if (limit === null) return { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 100." } };

  const groups = (data.dailyBossRawSnapshots ?? [])
    .filter((day) => !date || day.date === date)
    .map((day) => {
      const definition = bossDefinitionFromSnapshot(data, day);
      return {
        date: day.date,
        boss: definition,
        rows: (day.rows ?? [])
          .filter((row) => !playerId || row.playerId === playerId)
          .filter((row) => typeof row.bossDamageToday === "number")
          .sort((left, right) => (left.bossRank ?? Number.MAX_SAFE_INTEGER) - (right.bossRank ?? Number.MAX_SAFE_INTEGER))
          .slice(0, limit)
          .map((row) => ({
            rank: row.bossRank ?? null,
            playerId: row.playerId ?? null,
            name: row.name ?? null,
            damage: row.bossDamageToday,
            damageText: row.damageText ?? null,
          })),
      };
    })
    .filter((day) => !boss || day.boss.key === boss)
    .sort((left, right) => right.date.localeCompare(left.date));
  return { items: groups };
}

export function bossCatalogFromData(data) {
  const rankings = bossRankingsFromData(data);
  return rankings.byBoss.map(({ boss, rows }) => ({
    ...boss,
    recordedPlayers: rows.length,
    bestDamage: rows[0]?.damage ?? null,
    recordHolder: rows[0] ? { playerId: rows[0].playerId, name: rows[0].name } : null,
  }));
}

export function memberBossesFromData(data, playerId, publicOrigin = "") {
  const member = membersFromData(data, publicOrigin).find((item) => item.playerId === playerId);
  if (!member) return null;

  const rankings = bossRankingsFromData(data);
  const recordsByBoss = rankings.byBoss.map(({ boss, rows }) => {
    const recordIndex = rows.findIndex((row) => row.playerId === playerId);
    const record = recordIndex >= 0 ? rows[recordIndex] : null;
    const appearances = (data.dailyBossRawSnapshots ?? []).flatMap((day) =>
      (day.rows ?? [])
        .filter((row) => row.playerId === playerId && bossDefinitionFromSnapshot(data, day)?.key === boss.key && typeof row.bossDamageToday === "number")
        .map((row) => ({ date: day.date, damage: row.bossDamageToday, rank: row.bossRank ?? null })),
    );
    const latest = appearances.sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
    return {
      boss,
      bestDamage: record?.damage ?? null,
      bestDate: record?.date ?? null,
      bestDailyRank: record?.bossRank ?? null,
      guildRank: record ? recordIndex + 1 : null,
      participations: appearances.length,
      latest,
    };
  });

  const globalRecord = rankings.allTime.find((row) => row.playerId === playerId) ?? null;
  const latestWeek = rankings.weekly[0]?.weekStart ?? null;
  const weeklyRows = latestWeek ? rankings.weekly.filter((row) => row.weekStart === latestWeek) : [];
  const weeklyIndex = weeklyRows.findIndex((row) => row.playerId === playerId);
  const weekly = weeklyIndex >= 0 ? { ...weeklyRows[weeklyIndex], guildRank: weeklyIndex + 1 } : null;
  return {
    member: { playerId: member.playerId, name: member.name, links: member.links },
    globalRecord,
    weekly,
    recordsByBoss,
  };
}

export function queryMembers(members, searchParams) {
  const status = searchParams.get("status") ?? "active";
  if (!ALLOWED_MEMBER_STATUSES.has(status)) {
    return { error: { code: "invalid_status", message: "status must be active, former, or all." } };
  }

  const query = normalize(searchParams.get("q"));
  const limit = integerParameter(searchParams.get("limit"), 25, 1, 100);
  const offset = integerParameter(searchParams.get("offset"), 0, 0, 100_000);
  if (limit === null || offset === null) {
    return { error: { code: "invalid_pagination", message: "limit must be 1-100 and offset must be a positive integer." } };
  }

  const filtered = members.filter((member) => {
    const former = FORMER_STATUSES.has(member.guildStatus);
    if (status === "active" && former) return false;
    if (status === "former" && !former) return false;
    if (!query) return true;
    return normalize(`${member.playerId ?? ""} ${member.name ?? ""}`).includes(query);
  });

  return {
    items: filtered.slice(offset, offset + limit),
    pagination: { limit, offset, total: filtered.length, hasMore: offset + limit < filtered.length },
  };
}

export function findMember(members, playerId) {
  return members.find((member) => member.playerId === playerId) ?? null;
}

export function bossRankings(data, type, searchParams) {
  const rankings = bossRankingsFromData(data);
  const limit = integerParameter(searchParams.get("limit"), 10, 1, 100);
  if (limit === null) return { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 100." } };

  if (type === "all-time") return { items: rankings.allTime.slice(0, limit) };
  if (type === "weekly") {
    const week = dateParameter(searchParams.get("week"));
    if (week === false) return { error: { code: "invalid_week", message: "week must be a valid date using YYYY-MM-DD format." } };
    if (week && weekdayForDate(week) !== 1) {
      return { error: { code: "invalid_week", message: "week must identify a Monday." } };
    }
    const rows = week ? rankings.weekly.filter((row) => row.weekStart === week) : latestWeek(rankings.weekly);
    return { items: rows.slice(0, limit) };
  }
  if (type === "by-boss") {
    const boss = searchParams.get("boss");
    const groups = boss ? rankings.byBoss.filter((group) => group.boss.key === boss) : rankings.byBoss;
    return { items: groups.map((group) => ({ ...group, rows: group.rows.slice(0, limit) })) };
  }
  return { error: { code: "invalid_ranking", message: "ranking must be all-time, weekly, or by-boss." } };
}

function latestWeek(rows) {
  const latest = rows[0]?.weekStart;
  return latest ? rows.filter((row) => row.weekStart === latest) : [];
}

function rankingValue(member, metric) {
  if (metric === "activity") return member.metrics.lastActivityDays;
  return member.metrics[metric];
}

function rankingComparator(left, right, metric, order) {
  const ascending = order === "asc";
  const direction = ascending ? 1 : -1;
  const base = (left.value - right.value) * direction;
  if (base !== 0) return base;
  return left.name.localeCompare(right.name);
}

function rankingPosition(index, total, metric, order) {
  if (order === "asc" && metric !== "activity") return total - index;
  return index + 1;
}

function bestMemberMatch(member, rawQuery, normalizedQuery, publicOrigin) {
  if (member.playerId === rawQuery) return publicMatch(member, 1, "playerId", publicOrigin);
  const values = [
    ["name", member.name],
    ["discordName", member.discordName],
    ...((member.previousNames ?? []).map((value) => ["previousName", value])),
    ...((member.searchAliases ?? []).map((value) => ["alias", value])),
  ].filter(([, value]) => value);
  let best = publicMatch(member, 0, "name", publicOrigin);
  for (const [matchedBy, value] of values) {
    const normalizedValue = normalizeCompact(value);
    let confidence = stringSimilarity(normalizedQuery, normalizedValue);
    if (normalizedValue === normalizedQuery) confidence = 1;
    else if (normalizedValue.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedValue)) confidence = Math.max(confidence, 0.9);
    else if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) confidence = Math.max(confidence, 0.8);
    if (confidence > best.confidence) best = publicMatch(member, confidence, matchedBy, publicOrigin);
  }
  return best;
}

function publicMatch(member, confidence, matchedBy, publicOrigin) {
  return {
    playerId: member.playerId,
    name: member.name,
    confidence: Math.round(confidence * 100) / 100,
    matchedBy,
    webUrl: sharedMemberWebUrl(member.playerId, publicOrigin),
  };
}

function sharedMemberWebUrl(playerId, publicOrigin) {
  const code = createMemberShareCode(playerId, { expiresInHours: 12 });
  return absolutePublicUrl(
    `/s/${code}`,
    publicOrigin,
  );
}

function normalizeCompact(value) {
  return normalize(value).replace(/[^a-z0-9\u0400-\u04ff\u4e00-\u9fff]/g, "");
}

function stringSimilarity(left, right) {
  if (!left || !right) return 0;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function levenshtein(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : 1 + Math.min(diagonal, row[rightIndex], row[rightIndex - 1]);
      diagonal = above;
    }
  }
  return row[right.length];
}

function violationSummary(items) {
  const warningCountsByType = {};
  for (const member of items) {
    for (const warning of member.evaluation.warnings) {
      const type = warning.type ?? "unknown";
      warningCountsByType[type] = (warningCountsByType[type] ?? 0) + 1;
    }
  }
  return {
    totalMembers: items.length,
    warningCountsByType,
  };
}

function warningActionClosed(status) {
  return ["excused", "resolved", "ignored"].includes(status);
}

function dateParameter(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? value : false;
}

function weekdayForDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function normalize(value) {
  return String(value ?? "").trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function integerParameter(value, fallback, minimum, maximum) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : null;
}
