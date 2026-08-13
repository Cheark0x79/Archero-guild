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
  const absenceReason = cleanText(value.absenceReason, "absence reason");
  return {
    absenceUntil,
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
  if (!PLAYER_ID_PATTERN.test(playerId)) throw new Error("player ID must contain 6 to 20 digits");
  const records = await readMemberAdminRecords(root);
  const record = normalizeMemberAdminRecord(value);
  const destination = recordsPath(root);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify({ ...records, [playerId]: record }, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporary, destination);
  return record;
}

export async function moveMemberAdminRecord(root, currentPlayerId, playerId) {
  if (!PLAYER_ID_PATTERN.test(currentPlayerId) || !PLAYER_ID_PATTERN.test(playerId) || currentPlayerId === playerId) return;
  const records = await readMemberAdminRecords(root);
  if (!records[currentPlayerId]) return;
  const destination = recordsPath(root);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const nextRecords = { ...records, [playerId]: records[currentPlayerId] };
  delete nextRecords[currentPlayerId];
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(nextRecords, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporary, destination);
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
