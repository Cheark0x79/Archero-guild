import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(process.cwd(), "..");

test("release automation versions the image and preserves database deployment", () => {
  const makefile = fs.readFileSync(path.join(projectRoot, "Makefile"), "utf8");
  const compose = fs.readFileSync(path.join(projectRoot, "platform", "compose.yml"), "utf8");
  const dockerfile = fs.readFileSync(path.join(projectRoot, "platform", "Dockerfile"), "utf8");
  const ocrCompose = fs.readFileSync(path.join(projectRoot, "ocr", "compose.yml"), "utf8");
  const ocrDockerfile = fs.readFileSync(path.join(projectRoot, "ocr", "Dockerfile"), "utf8");
  const middleware = fs.readFileSync(path.join(projectRoot, "web", "middleware.js"), "utf8");
  const fallbackPage = fs.readFileSync(path.join(projectRoot, "web", "app", "[...fallback]", "page.jsx"), "utf8");
  const releaseScript = fs.readFileSync(path.join(projectRoot, "scripts", "release.sh"), "utf8");
  const backupScript = fs.readFileSync(path.join(projectRoot, "scripts", "backup.sh"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "web", "package.json"), "utf8"));
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
  assert.doesNotMatch(compose, /tesseract|ADB|screenshots:\/app\/screenshots/i);
  assert.match(dockerfile, /org\.opencontainers\.image\.version=\$APP_VERSION/);
  assert.doesNotMatch(dockerfile, /tesseract-ocr/);
  assert.match(ocrCompose, /127\.0\.0\.1:\$\{ARCHERO_OCR_UI_PORT:-5190\}:5190/);
  assert.match(ocrDockerfile, /tesseract-ocr/);
  assert.ok(
    releaseScript.indexOf("./scripts/wait-for-app.sh") < releaseScript.indexOf("> .release-version"),
    "the deployed version must only be recorded after the health check succeeds",
  );
  assert.ok(
    releaseScript.indexOf("sh ./scripts/backup.sh") < releaseScript.indexOf("build app"),
    "persistent data must be backed up before the release image is built",
  );
  assert.match(backupScript, /pg_dump/);
  assert.match(backupScript, /pg_restore --list/);
  assert.match(backupScript, /tar -tzf/);
  assert.match(backupScript, /sha256sum -c/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(projectRoot, "web", "app", "components", "DashboardApp.jsx"), "utf8"),
    /sample-data\.js/,
  );
  assert.equal(packageJson.scripts["check:public-bundle"], "node scripts/check-public-bundle.mjs");
  assert.doesNotMatch(middleware, /localDevelopment/);
  assert.doesNotMatch(middleware, /searchParams\.set\("next"/);
  assert.match(fallbackPage, /redirect\("\/dashboard"\)/);
});

test("React runtime packages are pinned to the same exact version", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "web", "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, "web", "package-lock.json"), "utf8"));
  const lockedRoot = packageLock.packages[""].dependencies;

  assert.match(packageJson.dependencies.react, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.dependencies["react-dom"], packageJson.dependencies.react);
  assert.equal(lockedRoot.react, packageJson.dependencies.react);
  assert.equal(lockedRoot["react-dom"], packageJson.dependencies["react-dom"]);
  assert.equal(packageLock.packages["node_modules/react"].version, packageJson.dependencies.react);
  assert.equal(packageLock.packages["node_modules/react-dom"].version, packageJson.dependencies["react-dom"]);
});
