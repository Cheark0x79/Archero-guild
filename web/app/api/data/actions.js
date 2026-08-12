import { spawn } from "node:child_process";
import path from "node:path";

export const DASHBOARD_ACTION_HEADER = "x-archero-dashboard-action";

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
        error: stderr.trim() || stdout.trim() || `OCR command exited with code ${code}`,
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

  return { file: "python", args };
}

export function observerEnv(extra = {}) {
  const cwd = projectRoot();
  return {
    ...process.env,
    ...extra,
    PYTHONPATH: [path.join(cwd, "ocr", "app"), cwd, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

export function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { output: stdout.trim() };
  }
}
