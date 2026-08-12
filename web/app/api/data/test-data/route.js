import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { ADMIN_ROLE, AUTH_COOKIE_NAME, roleForSessionToken } from "../../../../lib/auth.js";
import { defaultRules } from "../../../../default-rules.js";
import {
  createSyntheticImportBatches,
  databaseContainsOnlySyntheticMembers,
  syntheticTestDataAllowed,
} from "../../../../lib/test-data.js";
import { invalidateDashboardDataCache, loadDashboardData } from "../../dashboard-data/source.js";
import { hasDashboardActionHeader, runObserverModule } from "../actions.js";

export const maxDuration = 60;

export async function POST(request) {
  const rejected = authorizeSyntheticDataAction(request);
  if (rejected) return rejected;

  const unsafeDatabase = await rejectUnsafeDatabase();
  if (unsafeDatabase) return unsafeDatabase;

  const batches = createSyntheticImportBatches({
    seed: process.env.ARCHERO_DEMO_SEED,
    anchorDate: process.env.ARCHERO_DEMO_ANCHOR_DATE,
    scenario: process.env.ARCHERO_DEMO_SCENARIO,
  });
  let temporaryDirectory;
  const results = [];
  try {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "archero-test-data-"));
    for (const batch of batches) {
      const batchPath = path.join(temporaryDirectory, `${batch.captureDate}.json`);
      await fs.writeFile(batchPath, JSON.stringify(batch), { encoding: "utf8", flag: "wx" });
      const result = await runObserverModule("archero_guild.storage.ingest_batch", [batchPath]);
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error || `synthetic import failed for ${batch.captureDate}` },
          { status: result.status || 500 },
        );
      }
      results.push(result.data);
    }
    const rulesResult = await runObserverModule("archero_guild.storage.rules", ["--set-json", JSON.stringify(defaultRules)]);
    if (!rulesResult.ok) {
      return NextResponse.json({ ok: false, error: rulesResult.error || "synthetic rules initialization failed" }, { status: 500 });
    }
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }

  invalidateDashboardDataCache();
  return NextResponse.json({
    ok: true,
    synthetic: true,
    days: batches.length,
    members: batches.at(-1)?.members.filter((member) => member.playerId).length ?? 0,
    bossResults: batches.reduce((total, batch) => total + batch.bossRankings.length, 0),
    replayed: results.every((result) => result.replayed),
  });
}

export async function DELETE(request) {
  const rejected = authorizeSyntheticDataAction(request);
  if (rejected) return rejected;

  const unsafeDatabase = await rejectUnsafeDatabase();
  if (unsafeDatabase) return unsafeDatabase;

  const result = await runObserverModule("archero_guild.storage.clear_synthetic_data");
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "synthetic database clear was refused" },
      { status: result.status === 404 ? 404 : 409 },
    );
  }
  invalidateDashboardDataCache();
  return NextResponse.json({ ok: true, synthetic: true, cleared: result.data });
}

function authorizeSyntheticDataAction(request) {
  const role = roleForSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (role !== ADMIN_ROLE) {
    return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
  }
  if (!syntheticTestDataAllowed()) {
    return NextResponse.json({ ok: false, error: "synthetic test data is disabled" }, { status: 404 });
  }
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }
  return null;
}

async function rejectUnsafeDatabase() {
  const current = await loadDashboardData({ bypassCache: true });
  if (current.dataMode === "live" && !databaseContainsOnlySyntheticMembers(current.data?.guildRoster ?? [])) {
    return NextResponse.json(
      { ok: false, error: "the database contains non-synthetic members; refusing to mix test and real data" },
      { status: 409 },
    );
  }
  if (current.dataMode === "unavailable" && (current.data?.guildRoster?.length ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: "database state cannot be verified" }, { status: 503 });
  }
  return null;
}
