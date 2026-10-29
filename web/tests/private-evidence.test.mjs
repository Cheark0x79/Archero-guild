import test from "node:test";
import assert from "node:assert/strict";
import { handleEvidence, boundedJson, MAX_EVIDENCE_REQUEST } from "../lib/private-evidence.js";

function request(method = "GET", role = "admin", body, query = "") {
  const req = new Request(`http://localhost/api/admin/evidence${query}`, { method, headers: { "x-archero-dashboard-action": "1" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  req.cookies = { get: () => ({ value: role }) };
  return req;
}

test("private evidence denies public and member requests before storage access", async () => {
  process.env.ARCHERO_ADMIN_SESSION_TOKEN = "admin";
  process.env.ARCHERO_USER_SESSION_TOKEN = "user";
  for (const role of ["", "user", "invalid"]) {
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await handleEvidence(request(method, role, method === "GET" ? null : {}), () => assert.fail("unauthorized storage access"));
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  }
});

test("admin upload and deletion require action header", async () => {
  for (const method of ["POST", "DELETE"]) {
    const req = request(method, "admin", {});
    req.headers.delete("x-archero-dashboard-action");
    assert.equal((await handleEvidence(req, () => assert.fail("unsafe mutation"))).status, 400);
  }
});

test("download is a private non-rendering attachment; missing evidence stays explicit", async () => {
  const response = await handleEvidence(request("GET", "admin", null, "?id=123"), async (action, payload) => {
    assert.equal(action, "download"); assert.equal(payload.id, "123");
    return { status: 200, image: Buffer.from("synthetic").toString("base64"), mime: "image/png" };
  });
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.match(response.headers.get("content-disposition"), /^attachment/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "synthetic");
  assert.equal((await handleEvidence(request("GET", "admin", null, "?id=123"), async () => ({ status: 410, error: "evidence deleted" }))).status, 410);
});

test("chunked oversized requests are bounded without trusting content length", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_EVIDENCE_REQUEST + 1)); controller.close(); } });
  await assert.rejects(boundedJson(new Request("http://localhost", { method: "POST", body, duplex: "half" })), /too large/);
});

test("admin evidence and audit pagination forwards the cursor unchanged", async () => {
  for (const query of ["?kind=import&targetId=123&cursor=uuid", "?id=uuid&audit=1&cursor=100%3A205"]) {
    const response = await handleEvidence(request("GET", "admin", null, query), async (action, payload) => {
      assert.equal(action, query.includes("audit") ? "audit" : "list");
      assert.equal(payload.cursor, action === "audit" ? "100:205" : "uuid");
      return { status: 200, nextCursor: null };
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).nextCursor, null);
  }
});
