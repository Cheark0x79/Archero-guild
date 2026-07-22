import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { observerEnv, observerPythonCommand, parseJsonOutput, projectRoot } from "../actions.js";

const PROGRESS_PREFIX = "__ARCHERO_PROGRESS__";
const MAX_LOG_CHARS = 12000;
const MAX_RETAINED_JOBS = 10;
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

function state() {
  if (!globalThis.__archeroImportJobs) {
    globalThis.__archeroImportJobs = restoreJobsSnapshot(readJobsSnapshot()) ?? {
      jobs: new Map(),
      currentJobId: null,
      latestJobId: null,
    };
  }
  return globalThis.__archeroImportJobs;
}

export function startImportJob(date) {
  const current = currentImportJob();
  if (current && ACTIVE_STATUSES.has(current.status)) {
    return { job: publicJob(current), alreadyRunning: true };
  }

  const job = {
    id: crypto.randomUUID(),
    date: date || null,
    status: "queued",
    phase: "queued",
    stepIndex: 0,
    progress: 0,
    detail: "Queued import job.",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    stdout: "",
    stderr: "",
    result: null,
    error: null,
    exitCode: null,
  };

  const store = state();
  store.jobs.set(job.id, job);
  store.currentJobId = job.id;
  store.latestJobId = job.id;
  pruneJobs(store);
  persistJobsSnapshot(store);

  queueMicrotask(() => runImportJob(job));
  return { job: publicJob(job), alreadyRunning: false };
}

export function getImportJob(id = null) {
  const store = state();
  const jobId = id || store.currentJobId || store.latestJobId;
  if (!jobId) return null;
  return store.jobs.get(jobId) ?? null;
}

export function currentImportJob() {
  const store = state();
  return store.currentJobId ? store.jobs.get(store.currentJobId) ?? null : null;
}

export function publicJob(job) {
  return {
    id: job.id,
    date: job.date,
    status: job.status,
    phase: job.phase,
    stepIndex: job.stepIndex,
    progress: job.progress,
    detail: job.detail,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: publicError(job),
    exitCode: job.exitCode,
    retryable: job.status === "failed",
  };
}

function runImportJob(job) {
  updateJob(job, {
    status: "running",
    phase: "starting",
    stepIndex: 0,
    progress: 2,
    detail: "Starting observer import command.",
  });

  const command = observerPythonCommand(["-B", "-m", "observer.import_capture", ...(job.date ? [job.date] : [])]);
  const child = spawn(command.file, command.args, {
    cwd: projectRoot(),
    env: observerEnv({ ARCHERO_PROGRESS: "1" }),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    job.stdout = limitLog(job.stdout + chunk.toString());
    touch(job);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    job.stderr = limitLog(job.stderr + text);
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith(PROGRESS_PREFIX)) continue;
      try {
        applyProgress(job, JSON.parse(line.slice(PROGRESS_PREFIX.length)));
      } catch {
        touch(job);
      }
    }
  });

  child.on("error", (error) => {
    failJob(job, error.message, null);
  });

  child.on("close", (code) => {
    job.exitCode = code;
    if (code === 0) {
      updateJob(job, {
        status: "succeeded",
        phase: "done",
        stepIndex: 3,
        progress: 100,
        detail: "Import completed.",
        result: parseJsonOutput(job.stdout),
        finishedAt: new Date().toISOString(),
      });
      if (state().currentJobId === job.id) state().currentJobId = null;
      pruneJobs(state());
      persistJobsSnapshot(state());
      return;
    }
    failJob(job, errorFromLogs(job, code), code);
  });
}

function applyProgress(job, event) {
  updateJob(job, {
    status: "running",
    phase: event.phase ?? job.phase,
    stepIndex: stepIndexForPhase(event.phase),
    progress: typeof event.progress === "number" ? Math.max(job.progress, event.progress) : job.progress,
    detail: event.message ?? job.detail,
  });
}

function stepIndexForPhase(phase) {
  if (["find_raw", "detect_members", "detect_boss"].includes(phase)) return 0;
  if (["extract_current_members", "extract_daily_members", "extract_boss"].includes(phase)) return 1;
  if (["write_report", "persist_database"].includes(phase)) return 2;
  if (["update_front", "done"].includes(phase)) return 3;
  return 0;
}

function failJob(job, error, code) {
  console.error("Archero import job failed.", { id: job.id, date: job.date, exitCode: code });
  updateJob(job, {
    status: "failed",
    phase: "failed",
    stepIndex: job.stepIndex,
    detail: "Import failed.",
    error,
    exitCode: code,
    finishedAt: new Date().toISOString(),
  });
  if (state().currentJobId === job.id) state().currentJobId = null;
  pruneJobs(state());
  persistJobsSnapshot(state());
}

function errorFromLogs(job, code) {
  const stderr = job.stderr
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(PROGRESS_PREFIX))
    .join("\n")
    .trim();
  const stdout = job.stdout.trim();
  return stderr || stdout || `observer import exited with code ${code}`;
}

function updateJob(job, patch) {
  Object.assign(job, patch);
  touch(job);
}

function touch(job) {
  job.updatedAt = new Date().toISOString();
  persistJobsSnapshot(state());
}

function limitLog(value) {
  return value.length > MAX_LOG_CHARS ? value.slice(-MAX_LOG_CHARS) : value;
}

function publicError(job) {
  if (job.status !== "failed") return null;
  if (typeof job.error !== "string" || !job.error.trim()) {
    return "Import failed. Check server logs for details.";
  }
  if (/Traceback|^\s*File\s+"|ModuleNotFoundError|RuntimeError/im.test(job.error) || job.error.includes("\n")) {
    return "Import failed. Check server logs for details.";
  }
  return job.error.length <= 240 ? job.error : "Import failed. Check server logs for details.";
}

function pruneJobs(store) {
  const jobs = [...store.jobs.values()];
  const terminalJobs = jobs
    .filter((job) => TERMINAL_STATUSES.has(job.status))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const keepTerminalIds = new Set(terminalJobs.slice(0, MAX_RETAINED_JOBS).map((job) => job.id));
  for (const job of jobs) {
    if (ACTIVE_STATUSES.has(job.status) || keepTerminalIds.has(job.id)) continue;
    store.jobs.delete(job.id);
  }
}

function jobsSnapshotPath() {
  return path.join(projectRoot(), "data", "import-jobs", "state.json");
}

function readJobsSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(jobsSnapshotPath(), "utf8"));
  } catch {
    return null;
  }
}

function persistJobsSnapshot(store) {
  try {
    const filePath = jobsSnapshotPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(toJobsSnapshot(store), null, 2) + "\n", "utf8");
  } catch {
    // Status persistence is best-effort; the in-memory job remains authoritative.
  }
}

function toJobsSnapshot(store) {
  return {
    currentJobId: store.currentJobId,
    latestJobId: store.latestJobId,
    jobs: [...store.jobs.values()].map((job) => {
      const safeJob = publicJob(job);
      return {
        ...safeJob,
        stdout: "",
        stderr: "",
        result: safeJob.result ?? null,
        exitCode: safeJob.exitCode ?? null,
      };
    }),
  };
}

function restoreJobsSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.jobs)) return null;

  const store = {
    jobs: new Map(),
    currentJobId: null,
    latestJobId: typeof snapshot.latestJobId === "string" ? snapshot.latestJobId : null,
  };

  for (const item of snapshot.jobs) {
    if (!item || typeof item.id !== "string") continue;
    const restored = {
      id: item.id,
      date: typeof item.date === "string" ? item.date : null,
      status: ACTIVE_STATUSES.has(item.status) ? "failed" : item.status,
      phase: ACTIVE_STATUSES.has(item.status) ? "failed" : item.phase,
      stepIndex: typeof item.stepIndex === "number" ? item.stepIndex : 0,
      progress: typeof item.progress === "number" ? item.progress : 0,
      detail: ACTIVE_STATUSES.has(item.status) ? "Import state was interrupted. Start a new synchronization." : item.detail,
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
      finishedAt: item.finishedAt ?? (ACTIVE_STATUSES.has(item.status) ? new Date().toISOString() : null),
      stdout: "",
      stderr: "",
      result: item.result ?? null,
      error: ACTIVE_STATUSES.has(item.status) ? "Import state was interrupted. Start a new synchronization." : item.error,
      exitCode: item.exitCode ?? null,
    };
    store.jobs.set(restored.id, restored);
  }

  if (!store.latestJobId || !store.jobs.has(store.latestJobId)) {
    store.latestJobId = [...store.jobs.values()].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0]?.id ?? null;
  }
  pruneJobs(store);
  return store;
}

export const importJobInternalsForTest = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  publicError,
  pruneJobs,
  restoreJobsSnapshot,
  toJobsSnapshot,
};
