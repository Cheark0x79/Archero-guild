import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(process.cwd(), "..");

test("release automation versions the image and preserves database deployment", () => {
  const makefile = fs.readFileSync(path.join(projectRoot, "Makefile"), "utf8");
  const compose = fs.readFileSync(path.join(projectRoot, "docker-compose.prod.yml"), "utf8");
  const dockerfile = fs.readFileSync(path.join(projectRoot, "Dockerfile"), "utf8");
  const middleware = fs.readFileSync(path.join(projectRoot, "web", "middleware.js"), "utf8");
  const fallbackPage = fs.readFileSync(path.join(projectRoot, "web", "app", "[...fallback]", "page.jsx"), "utf8");
  const releaseScript = fs.readFileSync(path.join(projectRoot, "scripts", "release.sh"), "utf8");
  const version = fs.readFileSync(path.join(projectRoot, "VERSION"), "utf8").trim();

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(makefile, /^release:/m);
  assert.match(makefile, /up -d --no-deps app/);
  assert.match(compose, /image: archero-observer-app:\$\{ARCHERO_IMAGE_TAG:-local\}/);
  assert.match(compose, /APP_VERSION: \$\{ARCHERO_IMAGE_TAG:-local\}/);
  assert.match(compose, /ARCHERO_USER_PASSWORD: \$\{ARCHERO_USER_PASSWORD:\?Set ARCHERO_USER_PASSWORD\}/);
  assert.match(compose, /ARCHERO_USER_SESSION_TOKEN: \$\{ARCHERO_USER_SESSION_TOKEN:\?Set ARCHERO_USER_SESSION_TOKEN\}/);
  assert.match(compose, /mem_limit: 2g/);
  assert.match(compose, /pids_limit: 256/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(dockerfile, /org\.opencontainers\.image\.version=\$APP_VERSION/);
  assert.ok(
    releaseScript.indexOf("./scripts/wait-for-app.sh") < releaseScript.indexOf("> .release-version"),
    "the deployed version must only be recorded after the health check succeeds",
  );
  assert.doesNotMatch(middleware, /localDevelopment/);
  assert.doesNotMatch(middleware, /searchParams\.set\("next"/);
  assert.match(fallbackPage, /redirect\("\/dashboard"\)/);
});
