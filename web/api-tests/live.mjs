import assert from "node:assert/strict";

const baseUrl = process.env.ARCHERO_API_TEST_URL ?? "http://127.0.0.1:5182";
const token = process.env.ARCHERO_API_TOKEN;
const results = [];

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

async function check(name, run) {
  try {
    await run();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) });
  }
}

await check("health: success envelope", async () => {
  const result = await get("/api/v1/health");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.status, "ok");
  assert.equal(result.body.meta.apiVersion, "v1");
});

await check("members: pagination", async () => {
  const result = await get("/api/v1/members?limit=2&offset=0");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 2);
  assert.equal(result.body.meta.pagination.limit, 2);
});

await check("members: name search", async () => {
  const result = await get("/api/v1/members?q=EmberOne");
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].playerId, "900000108");
});

await check("members: former status", async () => {
  const result = await get("/api/v1/members?status=former");
  assert.equal(result.status, 200);
  assert.ok(result.body.data.every((member) => ["inactive", "left", "kicked"].includes(member.guildStatus)));
});

await check("members: invalid status", async () => {
  const result = await get("/api/v1/members?status=wrong");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "invalid_status");
});

await check("resolver: exact Player ID", async () => {
  const result = await get("/api/v1/members/resolve?q=900000108");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.match.name, "EmberOne");
});

await check("resolver: normalized name", async () => {
  const result = await get("/api/v1/members/resolve?q=Mundo");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.match.playerId, "900000111");
});

await check("resolver: typo", async () => {
  const result = await get("/api/v1/members/resolve?q=EmberOn");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.match.playerId, "900000108");
});

await check("resolver: missing query", async () => {
  const result = await get("/api/v1/members/resolve");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "missing_query");
});

await check("member detail: existing", async () => {
  const result = await get("/api/v1/members/900000108");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.name, "EmberOne");
});

await check("member detail: unknown", async () => {
  const result = await get("/api/v1/members/unknown");
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, "member_not_found");
});

await check("warnings: low donation type", async () => {
  const result = await get("/api/v1/warnings?type=low_contribution");
  assert.equal(result.status, 200);
  assert.ok(result.body.data.members.every((member) =>
    member.evaluation.warnings.some((warning) => warning.type === "low_contribution"),
  ));
});

await check("warnings: invalid type", async () => {
  const result = await get("/api/v1/warnings?type=critical");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "invalid_warning_type");
});

await check("rankings: highest power", async () => {
  const result = await get("/api/v1/rankings/members?metric=power&order=desc&limit=3");
  assert.equal(result.status, 200);
  assert.ok(result.body.data.rows[0].value >= result.body.data.rows[1].value);
});

await check("rankings: lowest donations", async () => {
  const result = await get("/api/v1/rankings/members?metric=contribution7d&order=asc&limit=3");
  assert.equal(result.status, 200);
  assert.ok(result.body.data.rows[0].value <= result.body.data.rows[1].value);
});

await check("rankings: invalid metric", async () => {
  const result = await get("/api/v1/rankings/members?metric=gold");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "invalid_metric");
});

await check("boss results: date and limit", async () => {
  const result = await get("/api/v1/boss-results?date=2026-07-22&limit=2");
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].date, "2026-07-22");
  assert.equal(result.body.data[0].rows.length, 2);
});

await check("boss results: player filter", async () => {
  const result = await get("/api/v1/boss-results?playerId=900000108");
  assert.equal(result.status, 200);
  assert.ok(result.body.data.every((group) => group.rows.every((row) => row.playerId === "900000108")));
});

await check("boss results: invalid date", async () => {
  const result = await get("/api/v1/boss-results?date=22-07-2026");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "invalid_date");
});

await check("boss results: impossible calendar date", async () => {
  const result = await get("/api/v1/boss-results?date=2026-02-31");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "invalid_date");
});

await check("member bosses: seven records", async () => {
  const result = await get("/api/v1/members/900000108/bosses");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.member.name, "EmberOne");
  assert.equal(result.body.data.recordsByBoss.length, 7);
});

await check("member bosses: unknown member", async () => {
  const result = await get("/api/v1/members/unknown/bosses");
  assert.equal(result.status, 404);
});

await check("member history: inverted date range", async () => {
  const result = await get("/api/v1/members/900000108/history?from=2026-07-22&to=2026-07-20");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "invalid_date_range");
});

await check("weekly boss ranking: invalid and non-Monday week", async () => {
  const invalid = await get("/api/v1/rankings/boss/weekly?week=nope");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "invalid_week");
  const nonMonday = await get("/api/v1/rankings/boss/weekly?week=2026-07-21");
  assert.equal(nonMonday.status, 400);
  assert.equal(nonMonday.body.error.code, "invalid_week");
});

for (const result of results) {
  console.log(`${result.status.padEnd(4)} ${result.name}${result.error ? ` — ${result.error}` : ""}`);
}

const failures = results.filter((result) => result.status === "FAIL");
console.log(`\n${results.length - failures.length}/${results.length} live API checks passed`);
if (failures.length > 0) process.exitCode = 1;
