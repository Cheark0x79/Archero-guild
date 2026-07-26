import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const CAPTURE_KINDS = new Set(["guild-members", "guild-boss"]);
export const DASHBOARD_ACTION_HEADER = "x-archero-dashboard-action";
const CAPTURE_LAYOUT = {
  "guild-members": ["guild", "members"],
  "guild-boss": ["boss", "boss"],
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_PIXELS = 12_000_000;

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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function validateCaptureDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function nextUploadPath(kind, date = captureDateToday()) {
  if (!CAPTURE_KINDS.has(kind)) throw new Error(`unknown capture kind: ${kind}`);
  if (!validateCaptureDate(date)) throw new Error("date must use YYYY-MM-DD format");

  const [subdir, prefix] = CAPTURE_LAYOUT[kind];
  const dayDir = path.join(projectRoot(), "screenshots", "raw", date, subdir);
  await fs.mkdir(dayDir, { recursive: true });
  const entries = await fs.readdir(dayDir).catch(() => []);
  const indexes = entries
    .map((name) => name.match(new RegExp(`^${prefix}-(\\d{3})\\.png$`)))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const nextIndex = Math.max(0, ...indexes) + 1;
  return {
    absolutePath: path.join(dayDir, `${prefix}-${String(nextIndex).padStart(3, "0")}.png`),
    index: nextIndex,
    date,
  };
}

export async function readUploadedPng(file) {
  if (typeof file.size === "number" && file.size > MAX_UPLOAD_BYTES) {
    throw new Error("PNG screenshot is too large");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("only PNG screenshots are supported");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("PNG screenshot is too large");
  }
  let metadata;
  try {
    const image = sharp(buffer, { failOn: "warning", limitInputPixels: MAX_UPLOAD_PIXELS });
    metadata = await image.metadata();
    await image.clone().raw().toBuffer();
  } catch {
    throw new Error("PNG screenshot is invalid or exceeds the pixel limit");
  }
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new Error("only valid PNG screenshots are supported");
  }
  return {
    buffer,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    size: buffer.length,
    width: metadata.width,
    height: metadata.height,
  };
}

export async function writePngBuffer(buffer, destination) {
  await fs.writeFile(destination, buffer, { flag: "wx" });
}

export async function findExistingScreenshotByHash(kind, date, sha256) {
  if (!CAPTURE_KINDS.has(kind)) throw new Error(`unknown capture kind: ${kind}`);
  if (!validateCaptureDate(date)) throw new Error("date must use YYYY-MM-DD format");
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("sha256 must be a lowercase hex digest");

  const [subdir, prefix] = CAPTURE_LAYOUT[kind];
  const dayDir = path.join(projectRoot(), "screenshots", "raw", date, subdir);
  const entries = await fs.readdir(dayDir).catch(() => []);
  for (const name of entries.sort()) {
    if (!new RegExp(`^${prefix}-(\\d{3})\\.png$`).test(name)) continue;
    const absolutePath = path.join(dayDir, name);
    const existing = await fs.readFile(absolutePath).catch(() => null);
    if (!existing) continue;
    const existingSha256 = crypto.createHash("sha256").update(existing).digest("hex");
    if (existingSha256 !== sha256) continue;
    return {
      absolutePath,
      index: Number(name.match(/-(\d{3})\.png$/)?.[1] ?? 0),
      date,
      sha256,
    };
  }
  return null;
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
