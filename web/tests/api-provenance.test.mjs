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
  const dataRoutes = routes.filter((file) => !file.endsWith(path.join("health", "route.js")));
  assert.ok(dataRoutes.length > 0);

  for (const file of dataRoutes) {
    const source = await fs.readFile(file, "utf8");
    assert.match(source, /loadDashboardData/, `${path.relative(apiRoot, file)} must load the shared data payload`);
    assert.match(source, /apiSuccess\([\s\S]*payload/, `${path.relative(apiRoot, file)} must pass provenance to apiSuccess`);
  }
});
