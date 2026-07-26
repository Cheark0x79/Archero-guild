import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { projectRoot } from "../actions.js";

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

export async function GET() {
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
    const destination = rulesPath();
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(rules, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporary, destination);
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "save failed" }, { status: 400 });
  }
}
