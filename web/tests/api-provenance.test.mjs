import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const apiRoot = path.resolve("app", "api", "v1");

async function routeFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(target);
    return entry.name === "route.js" ? [target] : [];
  }));
  return nested.flat();
}

test("every data-backed public API route propagates source provenance", async () => {
  const routes = await routeFiles(apiRoot);
  const nonDataRoutes = new Set([
    path.join("health", "route.js"),
    path.join("imports", "route.js"),
    path.join("imports", "validate", "route.js"),
  ]);
  const dataRoutes = routes.filter((file) => !nonDataRoutes.has(path.relative(apiRoot, file)));
  assert.ok(dataRoutes.length > 0);

  for (const file of dataRoutes) {
    const source = await fs.readFile(file, "utf8");
    assert.match(source, /loadDashboardData/, `${path.relative(apiRoot, file)} must load the shared data payload`);
    assert.match(source, /apiSuccess\([\s\S]*payload/, `${path.relative(apiRoot, file)} must pass provenance to apiSuccess`);
  }
});

test("every public API route returning member links supplies the public origin", async () => {
  const linkedRoutes = [
    path.join(apiRoot, "members", "route.js"),
    path.join(apiRoot, "members", "resolve", "route.js"),
    path.join(apiRoot, "members", "[playerId]", "route.js"),
    path.join(apiRoot, "members", "[playerId]", "bosses", "route.js"),
    path.join(apiRoot, "rankings", "members", "route.js"),
  ];

  for (const file of linkedRoutes) {
    const source = await fs.readFile(file, "utf8");
    assert.match(source, /publicApiOrigin\(request\)/, `${path.relative(apiRoot, file)} must use the configured public origin`);
  }
});
