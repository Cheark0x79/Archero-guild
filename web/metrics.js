export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompact(value) {
  if (Math.abs(value) >= 1_000 && Math.abs(value) < 1_000_000) {
    return `${trimTrailingZeros(value / 1_000, 2)}K`;
  }

  if (Math.abs(value) >= 1_000_000 && Math.abs(value) < 1_000_000_000) {
    return `${formatFixed(value / 1_000_000, 2)}M`;
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000_000 ? 1 : 0,
  }).format(value);
}

export function formatPowerDetail(value) {
  if (Math.abs(value) >= 1_000_000 && Math.abs(value) < 1_000_000_000) {
    return `${trimTrailingZeros(value / 1_000_000, 2)}M`;
  }
  return formatCompact(value);
}

export function parseBossDamageText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/,/g, ".");
  const match = normalized.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(trillion|trillions|t|billion|billions|b|million|millions|m)$/);
  if (!match) return null;

  const amount = Number(match[1].startsWith(".") ? `0${match[1]}` : match[1]);
  if (!Number.isFinite(amount)) return null;

  const unitText = match[2];
  const unit = unitText.startsWith("t") ? 1_000_000_000_000 : unitText.startsWith("b") ? 1_000_000_000 : 1_000_000;
  return Math.round(amount * unit);
}

export function formatBossDamageText(value, fallbackText = null) {
  if (typeof fallbackText === "string" && fallbackText.trim()) {
    return normalizeBossDamageText(fallbackText);
  }
  if (typeof value !== "number") return "Not recorded";

  return formatBossDamageValue(value);
}

function formatBossDamageValue(value) {
  const absolute = Math.abs(value);
  const unit = absolute >= 1_000_000_000_000 ? "T" : absolute >= 1_000_000_000 ? "B" : "M";
  const divisor = unit === "T" ? 1_000_000_000_000 : unit === "B" ? 1_000_000_000 : 1_000_000;
  return `${trimTrailingZeros(value / divisor, 2)}${unit}`;
}

function normalizeBossDamageText(value) {
  const normalized = value.trim().replace(/^([.,]\d+)/, "0$1").replace(/\s+/g, " ");
  const match = normalized.match(/^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(trillion|trillions|t|billion|billions|b|million|millions|m)$/i);
  if (!match) return normalized;
  const amount = match[1].replace(",", ".").replace(/^([.]\d+)/, "0$1");
  const unitText = match[2].toLowerCase();
  const unit = unitText.startsWith("t") ? "T" : unitText.startsWith("b") ? "B" : "M";
  return `${amount}${unit}`;
}

function trimTrailingZeros(value, maximumFractionDigits) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatFixed(value, fractionDigits) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function activityLabel(days) {
  if (days == null) return "Not recorded";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function evaluateMember(member, rules) {
  if (isFormerMember(member)) {
    return {
      status: member.status === "kicked" ? "Kicked" : "Left",
      flags: ["Not in current guild"],
      severity: "neutral",
    };
  }

  if (!member.metricsCaptured) {
    return {
      status: member.playerId ? "Not recorded" : "Missing ID",
      flags: [member.playerId ? "Metrics not recorded" : "Missing player ID"],
      severity: member.playerId ? "neutral" : "warning",
    };
  }

  if (!member.metricsVerified) {
    return {
      status: "Needs review",
      flags: ["Metrics need verification"],
      severity: "warning",
    };
  }

  if (isNewMember(member, rules)) {
    return {
      status: "Active",
      flags: ["New member grace period"],
      severity: "positive",
    };
  }

  const flags = [];
  const isExcused = Boolean(member.absenceUntil);

  if (!isExcused && member.lastActivityDays != null && member.lastActivityDays >= rules.maxInactiveDays) {
    flags.push("Game absence");
  }

  if (!isExcused && typeof member.contribution7d === "number" && member.contribution7d < rules.minContribution7d) {
    flags.push("Low contribution");
  }

  if (typeof member.power14dPercent === "number" && member.power14dPercent < rules.minPowerGrowth14dPercent) {
    flags.push("Low progression");
  }

  if (typeof member.bossAttacks === "number" && member.bossAttacks < bossTriesRequired(rules)) {
    flags.push("Missed boss");
  }

  let status = isExcused ? "Excused" : "Active";
  if (flags.length > 0) status = "Watch";
  if (!isExcused && member.lastActivityDays != null && member.lastActivityDays >= rules.maxInactiveDays) status = "Absent";
  if (member.status === "inactive") status = "Left";

  return {
    status,
    flags: isExcused && flags.length === 0 ? ["Excused absence"] : flags,
    severity: flags.length === 0 ? "positive" : status === "Absent" || status === "Left" ? "danger" : "warning",
  };
}

export function buildSummary(members, rules) {
  const currentMembers = members.filter((member) => !isFormerMember(member));
  const verifiedMembers = currentMembers.filter((member) => member.metricsVerified);
  const activeToday = verifiedMembers.filter((member) => member.lastActivityDays === 0).length;
  const totalContribution = verifiedMembers.reduce((sum, member) => sum + (member.contribution7d ?? 0), 0);
  const totalContributionDelta = verifiedMembers.reduce((sum, member) => sum + (member.contributionDelta ?? 0), 0);
  const bossDamage = verifiedMembers.reduce((sum, member) => sum + (member.bossDamageToday ?? 0), 0);
  const bossAttacks = verifiedMembers.reduce((sum, member) => sum + (member.bossAttacks ?? 0), 0);
  const bossAttacksDelta = verifiedMembers.reduce((sum, member) => sum + (member.bossAttacksDelta ?? 0), 0);
  const verifiedMetrics = currentMembers.filter((member) => member.metricsVerified).length;
  const reviewRequired = currentMembers.filter((member) => member.metricsCaptured && !member.metricsVerified).length;
  const watchCount = currentMembers.filter((member) => {
    const evaluation = evaluateMember(member, rules);
    return member.metricsVerified && ["warning", "danger"].includes(evaluation.severity);
  }).length;
  const knownIds = currentMembers.filter((member) => member.playerId).length;
  const unresolvedIds = currentMembers.length - knownIds;
  const capturedMetrics = currentMembers.filter((member) => member.metricsCaptured).length;
  const discordLinked = currentMembers.filter((member) => member.discordLinked).length;
  const discordMissing = currentMembers.length - discordLinked;
  const formerMembers = members.length - currentMembers.length;

  return {
    members: `${currentMembers.length}/${rules.memberCapacity}`,
    currentMembers: currentMembers.length,
    formerMembers,
    activeToday,
    totalContribution,
    totalContributionDelta,
    bossDamage,
    bossAttacks,
    bossAttacksDelta,
    watchCount,
    knownIds,
    unresolvedIds,
    capturedMetrics,
    verifiedMetrics,
    reviewRequired,
    discordLinked,
    discordMissing,
    freeSlots: Math.max(0, rules.memberCapacity - currentMembers.length),
  };
}

export function filterMembers(members, rules, query, statusFilter) {
  const normalizedQuery = normalizeSearchText(query);

  return members.filter((member) => {
    if (isFormerMember(member) && statusFilter !== "former") return false;

    const evaluation = evaluateMember(member, rules);
    const searchable = [
      member.playerId,
      member.name,
      member.discordName ?? "",
      member.discord ?? "",
      ...(member.searchAliases ?? []),
      ...member.previousNames,
    ]
      .join(" ")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

    const matchesQuery = normalizedQuery.length === 0 || searchable.includes(normalizedQuery);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && evaluation.status === "Active") ||
      (statusFilter === "watch" && evaluation.status === "Watch") ||
      (statusFilter === "absent" && evaluation.status === "Absent") ||
      (statusFilter === "former" && isFormerMember(member)) ||
      (statusFilter === "officer" && ["leader", "officer"].includes(member.role)) ||
      (statusFilter === "missing" && !member.metricsCaptured) ||
      (statusFilter === "review" && member.metricsCaptured && !member.metricsVerified) ||
      (statusFilter === "unresolved" && !member.playerId) ||
      (statusFilter === "discord-linked" && member.discordLinked) ||
      (statusFilter === "discord-missing" && !member.discordLinked);

    return matchesQuery && matchesStatus;
  });
}

export function sortMembers(members, rules, sort) {
  if (!sort.key) return members;

  return [...members].sort((left, right) => {
    const leftValue = sortValue(left, rules, sort.key);
    const rightValue = sortValue(right, rules, sort.key);
    const leftMissing = isMissingSortValue(leftValue);
    const rightMissing = isMissingSortValue(rightValue);

    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;

    const result = compareSortValues(leftValue, rightValue);
    return sort.direction === "asc" ? result : -result;
  });
}

export function defaultSortDirection(key) {
  return ["discord", "donation", "bossTries", "power", "capture"].includes(key) ? "desc" : "asc";
}

export function topBy(members, key, limit = 5) {
  return [...members]
    .filter((member) => member.metricsVerified && typeof member[key] === "number")
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit);
}

export function compareSourceRows(left, right) {
  const leftSource = sourceSortKey(left.source);
  const rightSource = sourceSortKey(right.source);
  return (
    leftSource.filePrefix.localeCompare(rightSource.filePrefix, undefined, { numeric: true, sensitivity: "base" }) ||
    leftSource.fileNumber - rightSource.fileNumber ||
    leftSource.fileName.localeCompare(rightSource.fileName, undefined, { numeric: true, sensitivity: "base" }) ||
    leftSource.areaOrder - rightSource.areaOrder ||
    leftSource.rowNumber - rightSource.rowNumber ||
    leftSource.directory.localeCompare(rightSource.directory, undefined, { numeric: true, sensitivity: "base" }) ||
    (left.name ?? "").localeCompare(right.name ?? "", undefined, { sensitivity: "base" })
  );
}

export function sourceSortKey(source) {
  const normalized = String(source ?? "").trim();
  const sourceMatch = normalized.match(/(?:^|\/)([^/\s]+?)(?:-(\d+))?\.png\s+(?:(podium)\s+(\d+)|row\s+(\d+))/i);
  const directoryMatch = normalized.match(/^(.+\/)[^/]+\.png/i);
  if (!sourceMatch) {
    return {
      directory: directoryMatch?.[1] ?? "",
      filePrefix: normalized.toLowerCase(),
      fileNumber: Number.MAX_SAFE_INTEGER,
      fileName: normalized.toLowerCase(),
      areaOrder: 99,
      rowNumber: Number.MAX_SAFE_INTEGER,
    };
  }

  const isPodium = Boolean(sourceMatch[3]);
  return {
    directory: directoryMatch?.[1] ?? "",
    filePrefix: sourceMatch[1].toLowerCase(),
    fileNumber: Number(sourceMatch[2] ?? 0),
    fileName: `${sourceMatch[1].toLowerCase()}-${sourceMatch[2] ?? ""}.png`,
    areaOrder: isPodium ? 0 : 1,
    rowNumber: Number(sourceMatch[4] ?? sourceMatch[5]),
  };
}

function sortValue(member, rules, key) {
  const evaluation = evaluateMember(member, rules);
  const roleRank = {
    leader: 0,
    officer: 1,
    elder: 2,
    member: 3,
  };
  const statusRank = {
    Active: 0,
    Excused: 1,
    Watch: 1,
    Absent: 2,
    "Needs review": 3,
    "Not recorded": 4,
    "Missing ID": 5,
    Left: 6,
    Kicked: 7,
  };

  switch (key) {
    case "playerId":
      return member.playerId ?? "";
    case "name":
      return member.name;
    case "discord":
      return member.discordLinked ? 1 : 0;
    case "role":
      return roleRank[member.role] ?? roleRank.member;
    case "activity":
      return member.lastActivityDays ?? Number.POSITIVE_INFINITY;
    case "donation":
      return member.contribution7d;
    case "bossTries":
      return member.bossAttacks;
    case "power":
      return member.power;
    case "capture":
      return member.lastSeenAt ? Date.parse(`${member.lastSeenAt}T00:00:00`) : 0;
    case "alerts":
      return statusRank[evaluation.status] ?? 99;
    default:
      return member.name;
  }
}

function compareSortValues(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function isMissingSortValue(value) {
  return value == null || value === "" || value === Number.POSITIVE_INFINITY;
}

export function mergeRosterMetrics(roster, snapshots) {
  const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.playerId, snapshot]));
  return roster.map((entry, index) => {
    const snapshot = entry.playerId ? snapshotsById.get(entry.playerId) : null;
    return {
      rowId: entry.playerId ?? `unresolved-${index}`,
      playerId: entry.playerId,
      name: entry.name,
      previousNames: snapshot?.previousNames ?? [],
      discord: snapshot?.discord ?? "",
      discordName: entry.discordName ?? entry.name,
      discordLinked: Boolean(entry.discordLinked),
      searchAliases: entry.searchAliases ?? snapshot?.searchAliases ?? [],
      role: snapshot?.role ?? "member",
      joinedAt: entry.joinedAt ?? snapshot?.joinedAt ?? null,
      leftAt: entry.leftAt ?? snapshot?.leftAt ?? null,
      status: entry.status ?? snapshot?.status ?? "active",
      absenceUntil: entry.absenceUntil ?? snapshot?.absenceUntil ?? null,
      absenceReason: entry.absenceReason ?? snapshot?.absenceReason ?? "",
      warnings: entry.warnings ?? snapshot?.warnings ?? [],
      officerNote: entry.officerNote ?? snapshot?.officerNote ?? "",
      power: snapshot?.power ?? null,
      power7d: snapshot?.power7d ?? null,
      power14dPercent: snapshot?.power14dPercent ?? null,
      chapter: snapshot?.chapter ?? null,
      tower: snapshot?.tower ?? null,
      jungle: snapshot?.jungle ?? null,
      equipment: snapshot?.equipment ?? null,
      contributionToday: snapshot?.contributionToday ?? null,
      contribution7d: snapshot?.contribution7d ?? null,
      contributionDelta: snapshot?.contributionDelta ?? null,
      contributionTotal: snapshot?.contributionTotal ?? null,
      bossDamageToday: snapshot?.bossDamageToday ?? null,
      bossDamageTotal: snapshot?.bossDamageTotal ?? null,
      bossRank: snapshot?.bossRank ?? null,
      bossAttacks: snapshot?.bossAttacks ?? null,
      bossAttacksDelta: snapshot?.bossAttacksDelta ?? null,
      powerDelta: snapshot?.powerDelta ?? null,
      previousSnapshot: snapshot?.previousSnapshot ?? null,
      lastSeenAt: snapshot?.lastSeenAt ?? snapshot?.previousSnapshot?.lastSeenAt ?? null,
      lastActivityDays: snapshot?.lastActivityDays ?? null,
      metricsCaptured: Boolean(snapshot),
      metricsVerified: snapshot?.metricsVerified === true,
      verificationNote: snapshot?.verificationNote ?? "",
    };
  });
}

export function isNewMember(member, rules) {
  const day = newMemberDay(member, rules);
  return day != null;
}

export function newMemberDay(member, rules) {
  if (!member.joinedAt || !rules.currentDate || !rules.newMemberGraceDays) return null;
  const joinedAt = Date.parse(`${member.joinedAt}T00:00:00`);
  const currentDate = Date.parse(`${rules.currentDate}T00:00:00`);
  if (Number.isNaN(joinedAt) || Number.isNaN(currentDate)) return null;
  const ageDays = Math.floor((currentDate - joinedAt) / 86_400_000);
  if (ageDays < 0 || ageDays >= rules.newMemberGraceDays) return null;
  return ageDays + 1;
}

function bossTriesRequired(rules) {
  if (typeof rules.minBossTries === "number") return rules.minBossTries;
  return rules.bossRequiredOnEventDay ? 1 : 0;
}

function isFormerMember(member) {
  return ["inactive", "left", "kicked"].includes(member.status);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function lineChartPath(values, width, height, padding = 22) {
  if (values.length === 0) return { line: "", area: "" };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;

  const points = values.map((value, index) => {
    const x = padding + index * step;
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return [x, y];
  });

  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L ${last[0].toFixed(1)} ${height - padding} L ${first[0].toFixed(1)} ${height - padding} Z`;

  return { line, area };
}
