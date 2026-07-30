import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { projectRoot, runObserverModule } from "../actions.js";
import { invalidateDashboardDataCache } from "../../dashboard-data/source.js";

const LIMITS = {
  maxInactiveDays: [0, 365],
  minContribution7d: [0, 1_000_000],
  minPowerGrowth14dPercent: [0, 1_000],
  minBossTries: [0, 100],
  newMemberGraceDays: [0, 365],
  memberCapacity: [1, 1_000],
};

function rulesPath() {
  return path.join(projectRoot(), "data", "rules.json");
}

function databaseConfigured() {
  return Boolean(process.env.ARCHERO_DATABASE_URL || process.env.DATABASE_URL);
}

function normalizeRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("rules must be an object");
  const rules = {};
  for (const [key, [minimum, maximum]] of Object.entries(LIMITS)) {
    const candidate = Number(value[key]);
    if (!Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
      throw new Error(`${key} must be between ${minimum} and ${maximum}`);
    }
    rules[key] = candidate;
  }
  return rules;
}

function normalizePartialRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("rules must be an object");
  const rules = {};
  for (const [key, candidateValue] of Object.entries(value)) {
    if (!(key in LIMITS)) continue;
    const [minimum, maximum] = LIMITS[key];
    const candidate = Number(candidateValue);
    if (!Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
      throw new Error(`${key} must be between ${minimum} and ${maximum}`);
    }
    rules[key] = candidate;
  }
  return rules;
}

export async function GET() {
  if (databaseConfigured()) {
    const result = await runObserverModule("observer.storage.rules");
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error || "database rules read failed" }, { status: 503 });
    }
    try {
      const storedRules = result.data?.rules;
      const complete = storedRules && Object.keys(LIMITS).every((key) => key in storedRules);
      return NextResponse.json({
        ok: true,
        rules: storedRules && Object.keys(storedRules).length > 0
          ? (complete ? normalizeRules(storedRules) : normalizePartialRules(storedRules))
          : null,
        incomplete: Boolean(storedRules) && !complete,
      });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "invalid database rules" }, { status: 500 });
    }
  }
  try {
    const rules = JSON.parse(await fs.readFile(rulesPath(), "utf8"));
    return NextResponse.json({ ok: true, rules: normalizeRules(rules) });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return NextResponse.json({ ok: true, rules: null });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "read failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const payload = await request.json();
    const rules = normalizeRules(payload.rules);
    if (databaseConfigured()) {
      const result = await runObserverModule("observer.storage.rules", ["--set-json", JSON.stringify(rules)]);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "database rules save failed" }, { status: 503 });
      }
      invalidateDashboardDataCache();
      return NextResponse.json({ ok: true, rules: normalizeRules(result.data?.rules) });
    }
    const destination = rulesPath();
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(rules, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporary, destination);
    invalidateDashboardDataCache();
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "save failed" }, { status: 400 });
  }
}
