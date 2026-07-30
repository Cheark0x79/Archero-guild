import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { localIsoDate } from "../../../date.js";

export const CAPTURE_KINDS = new Set(["guild-members", "guild-boss"]);
export const DASHBOARD_ACTION_HEADER = "x-archero-dashboard-action";
const CAPTURE_LAYOUT = {
  "guild-members": ["guild", "members"],
  "guild-boss": ["boss", "boss"],
};

export function hasDashboardActionHeader(request) {
  return request.headers.get(DASHBOARD_ACTION_HEADER) === "1";
}

export function projectRoot() {
  return path.basename(process.cwd()) === "web" ? path.resolve(process.cwd(), "..") : process.cwd();
}

export async function runObserverModule(moduleName, args = []) {
  const cwd = projectRoot();
  const env = observerEnv();
  const command = observerPythonCommand(["-B", "-m", moduleName, ...args]);

  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, status: 500, error: error.message, stdout, stderr });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, status: 200, data: parseJsonOutput(stdout), stdout, stderr });
        return;
      }
      resolve({
        ok: false,
        status: 500,
        error: stderr.trim() || stdout.trim() || `observer command exited with code ${code}`,
        stdout,
        stderr,
      });
    });
  });
}

export function observerPythonCommand(args = []) {
  const configured = process.env.ARCHERO_PYTHON;
  if (configured && configured.trim()) {
    return { file: configured.trim(), args };
  }

  if (process.env.IN_NIX_SHELL || !hasProjectFlake()) {
    return { file: "python", args };
  }

  return { file: "nix", args: ["develop", projectRoot(), "--command", "python", ...args] };
}

function hasProjectFlake() {
  return existsSync(path.join(projectRoot(), "flake.nix"));
}

export function observerEnv(extra = {}) {
  const cwd = projectRoot();
  const tesseractDirectory =
    process.platform === "win32" && existsSync("C:\\Program Files\\Tesseract-OCR\\tesseract.exe")
      ? "C:\\Program Files\\Tesseract-OCR"
      : null;
  const windowsTessdata =
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "ArcheroObserver", "tessdata")
      : null;
  return {
    ...process.env,
    ...extra,
    PATH: [tesseractDirectory, process.env.PATH].filter(Boolean).join(path.delimiter),
    PYTHONPATH: [cwd, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    TESSDATA_PREFIX: windowsTessdata && existsSync(windowsTessdata) ? windowsTessdata : process.env.TESSDATA_PREFIX,
  };
}

export async function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: projectRoot(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, status: 500, error: error.message, stdout, stderr });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        status: code === 0 ? 200 : 500,
        error: code === 0 ? null : stderr.trim() || stdout.trim() || `${command} exited with code ${code}`,
        stdout,
        stderr,
      });
    });
  });
}

export function captureDateToday() {
  return localIsoDate();
}

export function validateCaptureDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function relativeProjectPath(absolutePath) {
  return path.relative(projectRoot(), absolutePath).split(path.sep).join("/");
}

export function screenshotUrl(relativePath) {
  return `/api/data/screenshot?path=${encodeURIComponent(relativePath)}`;
}

export function resolveScreenshotPath(relativePath) {
  const root = path.join(projectRoot(), "screenshots", "raw");
  const resolved = path.resolve(projectRoot(), relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("screenshot path must stay under screenshots/raw");
  }
  if (path.extname(resolved).toLowerCase() !== ".png") {
    throw new Error("only PNG screenshots can be accessed");
  }
  return resolved;
}

export function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { output: stdout.trim() };
  }
}
