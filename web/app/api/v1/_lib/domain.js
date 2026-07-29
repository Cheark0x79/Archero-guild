import { buildSummary, evaluateMember, mergeRosterMetrics } from "../../../../metrics.js";
import { bossRankingsFromData } from "../../dashboard-data/source.js";
import { evaluateWarningHistory, warningHistoryEvents, warningHistorySummary } from "../../../../warning-history.js";
import { warningActionKey } from "../../../../lib/warning-actions.js";

const FORMER_STATUSES = new Set(["inactive", "left", "kicked"]);
const ALLOWED_MEMBER_STATUSES = new Set(["active", "former", "all"]);
const RANKING_METRICS = new Set(["power", "contribution7d", "powerDelta", "contributionDelta", "bossAttacks", "activity"]);

export function membersFromData(data) {
  return mergeRosterMetrics(data.guildRoster ?? [], data.memberSnapshots ?? []).map((member) => publicMember(member, data.rules ?? {}));
}

export function publicMember(member, rules) {
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
          api: `/api/v1/members/${encodeURIComponent(member.playerId)}`,
          web: `/members/${encodeURIComponent(member.playerId)}`,
        }
      : null,
  };
}

export function resolveMemberFromData(data, searchParams) {
  const query = searchParams.get("q")?.trim();
  const limit = integerParameter(searchParams.get("limit"), 5, 1, 10);
  if (!query) return { error: { code: "missing_query", message: "q is required." } };
  if (limit === null) return { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 10." } };

  const normalizedQuery = normalizeCompact(query);
  const candidates = mergeRosterMetrics(data.guildRoster ?? [], data.memberSnapshots ?? [])
    .filter((member) => member.playerId && !FORMER_STATUSES.has(member.status))
    .map((member) => bestMemberMatch(member, query, normalizedQuery))
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
    lastCapturedAt: data.captures?.lastCapturedAt ?? null,
    lastImportedAt: data.captures?.lastImportedAt ?? null,
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
  const severity = searchParams.get("severity");
  if (severity && !["warning", "danger"].includes(severity)) {
    return { error: { code: "invalid_severity", message: "severity must be warning or danger." } };
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
    .filter((member) => !severity || member.evaluation.severity === severity)
    .filter((member) => !flag || member.evaluation.flags.some((item) => normalize(item).includes(flag)))
    .sort((left, right) => severityRank(right.evaluation.severity) - severityRank(left.evaluation.severity) || left.name.localeCompare(right.name));
  const allHistory = (data.guildRoster ?? [])
    .filter((member) => member.playerId)
    .filter((member) => !playerId || member.playerId === playerId)
    .flatMap((member) =>
      memberWarningEvents(data, member.playerId)
        .filter((event) => !from || event.date >= from)
        .filter((event) => !to || event.date <= to)
        .filter((event) => !severity || event.severity === severity)
        .filter((event) => !flag || normalize(event.label).includes(flag))
        .map((event) => ({
          ...event,
          playerId: member.playerId,
          name: member.name,
          action: warningAction(data, member.playerId, event),
        })),
    )
    .sort((left, right) => right.date.localeCompare(left.date) || left.name.localeCompare(right.name));
  return {
    items,
    summary: violationSummary(items),
    history: allHistory.slice(0, historyLimit),
    historyPagination: {
      limit: historyLimit,
      total: allHistory.length,
      hasMore: allHistory.length > historyLimit,
    },
  };
}

export function memberRankingsFromData(data, searchParams) {
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

  const rankedMembers = membersFromData(data)
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
      ...warning,
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

function warningAction(data, playerId, event) {
  return data.warningActions?.[warningActionKey(playerId, event.date, event.type)] ?? {
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
    return !["excused", "resolved"].includes(action?.status);
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
      const definition = bossDefinitionForDate(day.date);
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

export function memberBossesFromData(data, playerId) {
  const member = membersFromData(data).find((item) => item.playerId === playerId);
  if (!member) return null;

  const rankings = bossRankingsFromData(data);
  const recordsByBoss = rankings.byBoss.map(({ boss, rows }) => {
    const recordIndex = rows.findIndex((row) => row.playerId === playerId);
    const record = recordIndex >= 0 ? rows[recordIndex] : null;
    const appearances = (data.dailyBossRawSnapshots ?? []).flatMap((day) =>
      (day.rows ?? [])
        .filter((row) => row.playerId === playerId && bossDefinitionForDate(day.date)?.key === boss.key && typeof row.bossDamageToday === "number")
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

function bestMemberMatch(member, rawQuery, normalizedQuery) {
  if (member.playerId === rawQuery) return publicMatch(member, 1, "playerId");
  const values = [
    ["name", member.name],
    ["discordName", member.discordName],
    ...((member.previousNames ?? []).map((value) => ["previousName", value])),
    ...((member.searchAliases ?? []).map((value) => ["alias", value])),
  ].filter(([, value]) => value);
  let best = publicMatch(member, 0, "name");
  for (const [matchedBy, value] of values) {
    const normalizedValue = normalizeCompact(value);
    let confidence = stringSimilarity(normalizedQuery, normalizedValue);
    if (normalizedValue === normalizedQuery) confidence = 1;
    else if (normalizedValue.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedValue)) confidence = Math.max(confidence, 0.9);
    else if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) confidence = Math.max(confidence, 0.8);
    if (confidence > best.confidence) best = publicMatch(member, confidence, matchedBy);
  }
  return best;
}

function publicMatch(member, confidence, matchedBy) {
  return {
    playerId: member.playerId,
    name: member.name,
    confidence: Math.round(confidence * 100) / 100,
    matchedBy,
    webUrl: `/members/${encodeURIComponent(member.playerId)}`,
  };
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
  const byFlag = {};
  for (const member of items) {
    for (const flag of member.evaluation.flags) byFlag[flag] = (byFlag[flag] ?? 0) + 1;
  }
  return {
    total: items.length,
    warning: items.filter((member) => member.evaluation.severity === "warning").length,
    danger: items.filter((member) => member.evaluation.severity === "danger").length,
    byFlag,
  };
}

function severityRank(value) {
  return value === "danger" ? 2 : value === "warning" ? 1 : 0;
}

function bossDefinitionForDate(date) {
  const definitions = [
    { key: "grim-reaper", weekday: 0, dayLabel: "Sun", name: "Grim Reaper" },
    { key: "treant-guardian", weekday: 1, dayLabel: "Mon", name: "Treant Guardian" },
    { key: "fire-dragon", weekday: 2, dayLabel: "Tue", name: "Fire Dragon" },
    { key: "flame-demon", weekday: 3, dayLabel: "Wed", name: "Flame Demon" },
    { key: "medusa", weekday: 4, dayLabel: "Thu", name: "Medusa" },
    { key: "stoneman", weekday: 5, dayLabel: "Fri", name: "Stoneman" },
    { key: "cyclops-mage", weekday: 6, dayLabel: "Sat", name: "Cyclops Mage" },
  ];
  const [year, month, day] = String(date).split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return definitions.find((definition) => definition.weekday === weekday);
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
