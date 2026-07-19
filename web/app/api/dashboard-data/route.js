import { NextResponse } from "next/server";
import {
  captures,
  changes,
  dailyBossRawSnapshots,
  dailyRawSnapshots,
  guildRoster,
  memberSnapshots,
  previousMemberSnapshots,
  rules,
  ocrQueue,
} from "../../../sample-data.js";
import { runObserverModule } from "../data/actions.js";

export async function GET() {
  const fallback = localPayload();
  if (!process.env.ARCHERO_DATABASE_URL && !process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, source: "local", data: fallback });
  }

  const result = await runObserverModule("observer.storage.export_json");
  if (!result.ok || !result.data || typeof result.data !== "object") {
    return NextResponse.json({
      ok: true,
      source: "local",
      warning: result.error ?? "Database export unavailable",
      data: fallback,
    });
  }

  return NextResponse.json({ ok: true, source: "database", data: mergeWithLocalFallback(result.data, fallback) });
}

function localPayload() {
  return {
    captures,
    changes,
    dailyBossRawSnapshots,
    dailyRawSnapshots,
    guildRoster,
    memberSnapshots,
    previousMemberSnapshots,
    rules,
    ocrQueue,
  };
}

function mergeWithLocalFallback(data, fallback) {
  return {
    captures: { ...fallback.captures, ...(data.captures ?? {}) },
    changes: arrayOrFallback(data.changes, fallback.changes),
    dailyBossRawSnapshots: arrayOrFallback(data.dailyBossRawSnapshots, fallback.dailyBossRawSnapshots),
    dailyRawSnapshots: arrayOrFallback(data.dailyRawSnapshots, fallback.dailyRawSnapshots),
    guildRoster: arrayOrFallback(data.guildRoster, fallback.guildRoster),
    memberSnapshots: arrayOrFallback(data.memberSnapshots, fallback.memberSnapshots),
    previousMemberSnapshots: arrayOrFallback(data.previousMemberSnapshots, fallback.previousMemberSnapshots),
    rules: { ...fallback.rules, ...(data.rules ?? {}) },
    ocrQueue: arrayOrFallback(data.ocrQueue, fallback.ocrQueue),
  };
}

function arrayOrFallback(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}
