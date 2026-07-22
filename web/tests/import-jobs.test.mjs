import test from "node:test";
import assert from "node:assert/strict";

import { importJobInternalsForTest, publicJob } from "../app/api/data/import/jobs.js";

function job(overrides = {}) {
  return {
    id: "job-1",
    date: "2026-07-20",
    status: "running",
    phase: "extract_current_members",
    stepIndex: 1,
    progress: 42,
    detail: "Extracting current guild metrics.",
    startedAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:05.000Z",
    finishedAt: null,
    stdout: "secret stdout",
    stderr: "secret stderr",
    result: null,
    error: null,
    exitCode: null,
    ...overrides,
  };
}

test("publicJob exposes reload-safe status without raw process logs", () => {
  const payload = publicJob(job());

  assert.equal(payload.id, "job-1");
  assert.equal(payload.status, "running");
  assert.equal(payload.progress, 42);
  assert.equal(payload.error, null);
  assert.equal(payload.retryable, false);
  assert.equal("stdout" in payload, false);
  assert.equal("stderr" in payload, false);
  assert.equal("stderrTail" in payload, false);
});

test("publicJob redacts stack traces from failed jobs", () => {
  const payload = publicJob(
    job({
      status: "failed",
      error: 'Traceback (most recent call last):\n  File "/app/secret.py", line 1\nRuntimeError: token leaked',
    }),
  );

  assert.equal(payload.error, "Import failed. Check server logs for details.");
  assert.equal(payload.retryable, true);
});

test("publicJob keeps short user-actionable import errors", () => {
  const payload = publicJob(job({ status: "failed", error: "no guild capture screenshots found in screenshots/raw/2026-07-20" }));

  assert.equal(payload.error, "no guild capture screenshots found in screenshots/raw/2026-07-20");
});

test("pruneJobs keeps active jobs and only the most recent terminal jobs", () => {
  const store = { jobs: new Map() };
  for (let index = 0; index < 12; index += 1) {
    const item = job({
      id: `done-${index}`,
      status: "succeeded",
      updatedAt: `2026-07-20T10:${String(index).padStart(2, "0")}:00.000Z`,
    });
    store.jobs.set(item.id, item);
  }
  const active = job({ id: "active", status: "running", updatedAt: "2026-07-20T09:00:00.000Z" });
  store.jobs.set(active.id, active);

  importJobInternalsForTest.pruneJobs(store);

  assert.equal(store.jobs.has("active"), true);
  assert.equal(store.jobs.size, 11);
  assert.equal(store.jobs.has("done-0"), false);
  assert.equal(store.jobs.has("done-1"), false);
  assert.equal(store.jobs.has("done-11"), true);
});

test("toJobsSnapshot persists status without raw stdout or stderr", () => {
  const store = {
    currentJobId: "job-1",
    latestJobId: "job-1",
    jobs: new Map([["job-1", job()]]),
  };

  const snapshot = importJobInternalsForTest.toJobsSnapshot(store);

  assert.equal(snapshot.currentJobId, "job-1");
  assert.equal(snapshot.jobs[0].stdout, "");
  assert.equal(snapshot.jobs[0].stderr, "");
  assert.equal("stderrTail" in snapshot.jobs[0], false);
});

test("restoreJobsSnapshot marks active persisted jobs as interrupted", () => {
  const snapshot = {
    currentJobId: "job-1",
    latestJobId: "job-1",
    jobs: [job({ status: "running", phase: "extract_current_members" })],
  };

  const store = importJobInternalsForTest.restoreJobsSnapshot(snapshot);
  const restored = store.jobs.get("job-1");

  assert.equal(store.currentJobId, null);
  assert.equal(store.latestJobId, "job-1");
  assert.equal(restored.status, "failed");
  assert.equal(publicJob(restored).error, "Import state was interrupted. Start a new synchronization.");
});
