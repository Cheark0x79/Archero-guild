import fs from "node:fs/promises";
import path from "node:path";

export const WARNING_ACTION_STATUSES = new Set(["pending", "noted", "contacted", "excused", "resolved"]);
export const WARNING_TYPES = new Set(["game_absence", "low_contribution", "low_progression", "missed_boss"]);

export function warningActionKey(playerId, date, type) {
  return `${playerId}:${date}:${type}`;
}

export function normalizeWarningAction(input) {
  const playerId = String(input?.playerId ?? "").trim();
  const date = String(input?.date ?? "").trim();
  const type = String(input?.type ?? "").trim();
  const status = String(input?.status ?? "").trim();
  const note = String(input?.note ?? "").trim();
  if (!/^\d{1,32}$/.test(playerId)) throw new Error("playerId is invalid");
  if (!validDate(date)) throw new Error("date must use YYYY-MM-DD format");
  if (!WARNING_TYPES.has(type)) throw new Error("warning type is invalid");
  if (!WARNING_ACTION_STATUSES.has(status)) throw new Error("warning status is invalid");
  if (note.length > 500) throw new Error("note must not exceed 500 characters");
  return { playerId, date, type, status, note };
}

export async function readWarningActions(projectRoot) {
  try {
    const parsed = JSON.parse(await fs.readFile(actionsPath(projectRoot), "utf8"));
    return normalizeWarningActions(parsed);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function saveWarningAction(projectRoot, input) {
  const action = normalizeWarningAction(input);
  const actions = await readWarningActions(projectRoot);
  const key = warningActionKey(action.playerId, action.date, action.type);
  actions[key] = { ...action, updatedAt: new Date().toISOString() };
  const destination = actionsPath(projectRoot);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(actions, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporary, destination);
  return actions[key];
}

function normalizeWarningActions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const action of Object.values(value)) {
    try {
      const clean = normalizeWarningAction(action);
      normalized[warningActionKey(clean.playerId, clean.date, clean.type)] = {
        ...clean,
        ...(typeof action.updatedAt === "string" ? { updatedAt: action.updatedAt } : {}),
      };
    } catch {
      // Ignore stale or malformed entries without breaking the dashboard.
    }
  }
  return normalized;
}

function actionsPath(projectRoot) {
  return path.join(projectRoot, "data", "warning-actions.json");
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
