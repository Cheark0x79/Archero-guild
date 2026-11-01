import { spawn } from "node:child_process";
import { ADMIN_ROLE, AUTH_COOKIE_NAME, roleForSessionToken } from "./auth.js";
import { hasDashboardActionHeader, observerEnv, observerPythonCommand, projectRoot } from "../app/api/data/actions.js";

export const MAX_EVIDENCE_REQUEST = 7 * 1024 * 1024;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };

export async function boundedJson(request) {
  if (!request.body) throw new Error("missing body");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EVIDENCE_REQUEST) throw new Error("request too large");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
  }
}

export function runEvidence(action, payload) {
  const command = observerPythonCommand(["-B", "-m", "archero_guild.storage.private_evidence"]);
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, { cwd: projectRoot(), env: observerEnv(), shell: false, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const unavailable = { status: 503, error: "private evidence storage unavailable" };
    const timer = setTimeout(() => { child.kill(); finish(unavailable); }, 15000);
    child.on("error", () => finish(unavailable));
    child.stdin.on("error", () => finish(unavailable));
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > MAX_EVIDENCE_REQUEST + 1024) { child.kill(); finish(unavailable); }
    });
    child.on("close", (code) => {
      if (code !== 0) return finish(unavailable);
      try { finish(JSON.parse(output)); } catch { finish(unavailable); }
    });
    child.stdin.end(JSON.stringify({ action, payload }));
  });
}

export async function handleEvidence(request, run = runEvidence) {
  const json = (body, status) => Response.json(body, { status, headers: PRIVATE_HEADERS });
  if (roleForSessionToken(request.cookies?.get(AUTH_COOKIE_NAME)?.value) !== ADMIN_ROLE) {
    return json({ error: "administrator access required" }, 403);
  }
  if (!["GET", "POST", "DELETE"].includes(request.method)) return json({ error: "method not allowed" }, 405);
  if (request.method !== "GET" && !hasDashboardActionHeader(request)) return json({ error: "missing dashboard action header" }, 400);
  try {
    const url = new URL(request.url);
    let action;
    let payload;
    if (request.method === "GET") {
      action = url.searchParams.has("id") ? (url.searchParams.get("audit") === "1" ? "audit" : "download") : "list";
      payload = { id: url.searchParams.get("id"), cursor: url.searchParams.get("cursor"), target: { kind: url.searchParams.get("kind"), id: url.searchParams.get("targetId") } };
    } else {
      action = request.method === "POST" ? "upload" : "delete";
      payload = await boundedJson(request);
    }
    const result = await run(action, payload);
    if (action === "download" && result.status === 200) {
      const extension = result.mime === "image/png" ? "png" : "jpg";
      return new Response(Buffer.from(result.image, "base64"), { headers: { ...PRIVATE_HEADERS,
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="evidence.${extension}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    const { status, ...body } = result;
    return json(body, status);
  } catch {
    return json({ error: "invalid evidence request" }, 400);
  }
}
