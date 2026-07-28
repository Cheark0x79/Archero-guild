const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ALLOWED_IMAGE_KINDS = new Set(["guild-members", "guild-boss"]);

export const IMPORT_BATCH_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BATCH_BYTES = 2 * 1024 * 1024;

export function validateImportBatch(batch, { requirePublishable = false } = {}) {
  const errors = [];
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    return { valid: false, publishable: false, errors: ["body must be a JSON object"] };
  }

  if (batch.schemaVersion !== IMPORT_BATCH_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${IMPORT_BATCH_SCHEMA_VERSION}`);
  }
  if (!DATE_PATTERN.test(String(batch.captureDate ?? "")) || !isRealDate(batch.captureDate)) {
    errors.push("captureDate must be a real YYYY-MM-DD date");
  }
  if (!isIsoDateTime(batch.generatedAt)) errors.push("generatedAt must be an ISO date-time");
  if (!isBoundedString(batch.agentVersion, 1, 128)) errors.push("agentVersion is required");
  if (!isBoundedString(batch.idempotencyKey, 16, 200)) errors.push("idempotencyKey must contain 16 to 200 characters");

  if (!Array.isArray(batch.sourceImages) || batch.sourceImages.length === 0) {
    errors.push("sourceImages must contain at least one image");
  } else {
    batch.sourceImages.forEach((image, index) => validateSourceImage(image, index, errors));
  }
  if (!Array.isArray(batch.members) || batch.members.length > 100) {
    errors.push("members must be an array containing at most 100 rows");
  } else {
    batch.members.forEach((member, index) => validateMember(member, index, errors));
    rejectDuplicateValues(batch.members, "playerId", "members", errors);
  }
  if (!Array.isArray(batch.bossRankings) || batch.bossRankings.length > 100) {
    errors.push("bossRankings must be an array containing at most 100 rows");
  } else {
    batch.bossRankings.forEach((ranking, index) => validateBossRanking(ranking, index, errors));
    rejectDuplicateValues(batch.bossRankings, "rank", "bossRankings", errors);
  }

  const quality = batch.quality;
  if (!quality || typeof quality !== "object") {
    errors.push("quality is required");
  } else {
    if (!["pass", "review", "failed"].includes(quality.status)) errors.push("quality.status is invalid");
    if (!isRatio(quality.coverage)) errors.push("quality.coverage must be between 0 and 1");
    if (!isRatio(quality.completeness)) errors.push("quality.completeness must be between 0 and 1");
    if (!Array.isArray(quality.warnings)) errors.push("quality.warnings must be an array");
  }

  const publishable =
    errors.length === 0
    && quality?.status === "pass"
    && quality?.coverage === 1
    && quality?.completeness === 1;
  if (requirePublishable && !publishable) {
    errors.push("quality gate requires pass with 100% coverage and completeness");
  }
  return { valid: errors.length === 0, publishable, errors };
}

function validateSourceImage(image, index, errors) {
  const prefix = `sourceImages[${index}]`;
  if (!image || typeof image !== "object") return errors.push(`${prefix} must be an object`);
  if (!ALLOWED_IMAGE_KINDS.has(image.kind)) errors.push(`${prefix}.kind is invalid`);
  if (!SHA256_PATTERN.test(String(image.sha256 ?? ""))) errors.push(`${prefix}.sha256 is invalid`);
  if (!isIntegerBetween(image.width, 1, 10000)) errors.push(`${prefix}.width is invalid`);
  if (!isIntegerBetween(image.height, 1, 20000)) errors.push(`${prefix}.height is invalid`);
  if (!isIntegerBetween(image.detectedRows, 0, 100)) errors.push(`${prefix}.detectedRows is invalid`);
}

function validateMember(member, index, errors) {
  const prefix = `members[${index}]`;
  if (!member || typeof member !== "object") return errors.push(`${prefix} must be an object`);
  if (!isBoundedString(member.name, 1, 128)) errors.push(`${prefix}.name is required`);
  if (!isBoundedString(member.source, 1, 255)) errors.push(`${prefix}.source is required`);
  if (!nullableNonNegativeInteger(member.power)) errors.push(`${prefix}.power is invalid`);
  if (!nullableNonNegativeInteger(member.contribution7d)) errors.push(`${prefix}.contribution7d is invalid`);
  if (!nullableIntegerBetween(member.bossAttacks, 0, 10)) errors.push(`${prefix}.bossAttacks is invalid`);
  if (!nullableNonNegativeInteger(member.lastActivityDays)) errors.push(`${prefix}.lastActivityDays is invalid`);
}

function validateBossRanking(ranking, index, errors) {
  const prefix = `bossRankings[${index}]`;
  if (!ranking || typeof ranking !== "object") return errors.push(`${prefix} must be an object`);
  if (!isBoundedString(ranking.name, 1, 128)) errors.push(`${prefix}.name is required`);
  if (!isIntegerBetween(ranking.rank, 1, 100)) errors.push(`${prefix}.rank is invalid`);
  if (!isBoundedString(ranking.damageText, 1, 32)) errors.push(`${prefix}.damageText is required`);
  if (!isIntegerBetween(ranking.damage, 0, Number.MAX_SAFE_INTEGER)) errors.push(`${prefix}.damage is invalid`);
  if (!isBoundedString(ranking.source, 1, 255)) errors.push(`${prefix}.source is required`);
}

function rejectDuplicateValues(rows, key, label, errors) {
  const seen = new Set();
  for (const row of rows) {
    const value = row?.[key];
    if (value === null || value === undefined || value === "") continue;
    if (seen.has(value)) errors.push(`${label} contains duplicate ${key}: ${value}`);
    seen.add(value);
  }
}

function isRealDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value) {
  return typeof value === "string" && value.includes("T") && !Number.isNaN(Date.parse(value));
}

function isBoundedString(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isRatio(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isIntegerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function nullableNonNegativeInteger(value) {
  return value === null || value === undefined || isIntegerBetween(value, 0, Number.MAX_SAFE_INTEGER);
}

function nullableIntegerBetween(value, minimum, maximum) {
  return value === null || value === undefined || isIntegerBetween(value, minimum, maximum);
}
