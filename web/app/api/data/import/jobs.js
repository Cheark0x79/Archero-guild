import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { observerEnv, parseJsonOutput, projectRoot } from "../actions.js";

const PROGRESS_PREFIX = "__ARCHERO_PROGRESS__";
const MAX_LOG_CHARS = 12000;

function state() {
  if (!globalThis.__archeroImportJobs) {
    globalThis.__archeroImportJobs = {
      jobs: new Map(),
      currentJobId: null,
      latestJobId: null,
    };
  }
  return globalThis.__archeroImportJobs;
}

export function startImportJob(date) {
  const current = currentImportJob();
  if (current && ["queued", "running"].includes(current.status)) {
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
    error: job.error,
    exitCode: job.exitCode,
    stderrTail: tail(job.stderr),
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

  const child = spawn("python", ["-B", "-m", "observer.import_capture", ...(job.date ? [job.date] : [])], {
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
}

function tail(value) {
  return value.length > 3000 ? value.slice(-3000) : value;
}

function limitLog(value) {
  return value.length > MAX_LOG_CHARS ? value.slice(-MAX_LOG_CHARS) : value;
}
