import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PLAYER_ID_PATTERN = /^\d{6,20}$/;
const MAX_ITEMS = 20;
const MAX_TEXT_LENGTH = 500;

export function normalizeMemberAdminRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("member administration data must be an object");
  }
  const absenceUntil = cleanDate(value.absenceUntil);
  const absenceFrom = cleanDate(value.absenceFrom) ?? absenceUntil;
  if (absenceUntil && absenceFrom > absenceUntil) throw new Error("absence start must precede end");
  const absenceReason = cleanText(value.absenceReason, "absence reason");
  return {
    absenceFrom: absenceUntil ? absenceFrom : null,
    absenceUntil,
    absences: (value.absences ?? []).map(period => {
      const from = cleanDate(period.from);
      const until = cleanDate(period.until);
      if (!from || !until || from > until) throw new Error("invalid absence period");
      return { from, until, note: cleanText(period.note, "absence note") };
    }),
    audit: Array.isArray(value.audit) ? value.audit : [],
    absenceReason: absenceUntil ? absenceReason : "",
    warnings: normalizeItems(value.warnings, "reason"),
    notes: normalizeItems(value.notes, "note"),
  };
}

export async function readMemberAdminRecords(root) {
  try {
    const payload = JSON.parse(await fs.readFile(recordsPath(root), "utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return Object.fromEntries(
      Object.entries(payload)
        .filter(([playerId]) => PLAYER_ID_PATTERN.test(playerId))
        .map(([playerId, record]) => [playerId, normalizeMemberAdminRecord(record)]),
    );
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function saveMemberAdminRecord(root, playerId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("member administration data must be an object");
  if (!PLAYER_ID_PATTERN.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
  return withRecordsLock(root, async () => {
    const records = await readMemberAdminRecords(root);
    const previous = records[playerId] ?? normalizeMemberAdminRecord({});
    const record = normalizeMemberAdminRecord({ ...value, absences: previous.absences, audit: previous.audit });
    const changedAbsence = ['absenceFrom', 'absenceUntil', 'absenceReason'].some(key => record[key] !== previous[key]);
    if (changedAbsence && previous.absenceUntil) {
      const until = [previous.absenceUntil, new Date().toISOString().slice(0, 10)].sort()[0];
      if (previous.absenceFrom <= until) record.absences.push({ from: previous.absenceFrom, until, note: previous.absenceReason });
    }
    if (changedAbsence || JSON.stringify(record.warnings) !== JSON.stringify(previous.warnings) || JSON.stringify(record.notes) !== JSON.stringify(previous.notes)) {
      record.audit = [...previous.audit, { at: new Date().toISOString(), actor: 'administrator', before: { absenceFrom: previous.absenceFrom, absenceUntil: previous.absenceUntil, absenceReason: previous.absenceReason, warnings: previous.warnings, notes: previous.notes }, after: { absenceFrom: record.absenceFrom, absenceUntil: record.absenceUntil, absenceReason: record.absenceReason, warnings: record.warnings, notes: record.notes } }];
    }
    const destination = recordsPath(root);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify({ ...records, [playerId]: record }, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporary, destination);
    return record;
  });
}

export async function moveMemberAdminRecord(root, currentPlayerId, playerId) {
  if (!PLAYER_ID_PATTERN.test(currentPlayerId) || !PLAYER_ID_PATTERN.test(playerId) || currentPlayerId === playerId) return;
  return withRecordsLock(root, async () => {
    const records = await readMemberAdminRecords(root);
    if (!records[currentPlayerId]) return;
    const destination = recordsPath(root);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    const nextRecords = { ...records, [playerId]: records[currentPlayerId] };
    delete nextRecords[currentPlayerId];
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(nextRecords, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporary, destination);
  });
}

// One lock covers the shared JSON file, including separate Node worker processes.
// Never steal an existing lock: after a crashed writer, fail closed until an
// operator confirms all writers have stopped and removes the orphaned lock.
async function withRecordsLock(root, update) {
  const lockPath = `${recordsPath(root)}.lock`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 5_000;
  let lock;
  while (!lock) {
    try {
      lock = await fs.open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        const busy = new Error("Member administration is busy; retry after the current update finishes.");
        busy.code = "MEMBER_ADMIN_BUSY";
        throw busy;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    return await update();
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

function recordsPath(root) {
  return path.join(root, "data", "member-admin.json");
}

function cleanDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("absence end date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("absence end date is invalid");
  }
  return value;
}

function cleanText(value, label) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const cleaned = value.trim();
  if (cleaned.length > MAX_TEXT_LENGTH) throw new Error(`${label} is too long`);
  return cleaned;
}

function normalizeItems(value, key) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error(`too many ${key === "reason" ? "warnings" : "notes"}`);
  return value.map((item) => {
    const source = typeof item === "string" ? { [key]: item } : item;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`invalid ${key}`);
    const text = cleanText(source[key], key);
    if (!text) throw new Error(`${key} cannot be empty`);
    const at = cleanDate(source.at) ?? new Date().toISOString().slice(0, 10);
    return { [key]: text, at };
  });
}
