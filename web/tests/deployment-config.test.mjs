import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(process.cwd(), "..");

test("production packaging preserves the database and operational safeguards", () => {
  const makefile = fs.readFileSync(path.join(projectRoot, "Makefile"), "utf8");
  const compose = fs.readFileSync(path.join(projectRoot, "web", "compose.yml"), "utf8");
  const devCompose = fs.readFileSync(path.join(projectRoot, "web", "compose.dev.yml"), "utf8");
  const testCompose = fs.readFileSync(path.join(projectRoot, "web", "compose.test.yml"), "utf8");
  const dockerfile = fs.readFileSync(path.join(projectRoot, "web", "Dockerfile"), "utf8");
  const ocrCompose = fs.readFileSync(path.join(projectRoot, "ocr", "compose.yml"), "utf8");
  const ocrDockerfile = fs.readFileSync(path.join(projectRoot, "ocr", "Dockerfile"), "utf8");
  const publishWorkflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "publish-container.yml"),
    "utf8",
  );
  const middleware = fs.readFileSync(path.join(projectRoot, "web", "middleware.js"), "utf8");
  const fallbackPage = fs.readFileSync(path.join(projectRoot, "web", "app", "[...fallback]", "page.jsx"), "utf8");
  const backupScript = fs.readFileSync(path.join(projectRoot, "web", "scripts", "backup.sh"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "web", "package.json"), "utf8"));
  const version = fs.readFileSync(path.join(projectRoot, "VERSION"), "utf8").trim();

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(makefile, /^update:/m);
  assert.match(makefile, /^stop:/m);
  assert.match(makefile, /^test:/m);
  assert.match(makefile, /^build:/m);
  assert.match(makefile, /^doctor:/m);
  assert.match(makefile, /^backup:/m);
  assert.match(makefile, /pull app/);
  assert.match(makefile, /up -d --no-deps --no-build --wait --wait-timeout 90 app/);
  assert.match(compose, /image: \$\{ARCHERO_WEB_IMAGE:-ghcr\.io\/cheark0x79\/archero-guild-web\}:\$\{ARCHERO_IMAGE_TAG:-latest\}/);
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.doesNotMatch(compose, /cloudflare|cloudflared|tunnel/i);
  assert.match(compose, /APP_VERSION: \$\{ARCHERO_IMAGE_TAG:-latest\}/);
  assert.match(compose, /ARCHERO_USER_PASSWORD: \$\{ARCHERO_USER_PASSWORD:\?Set ARCHERO_USER_PASSWORD\}/);
  assert.match(compose, /ARCHERO_USER_SESSION_TOKEN: \$\{ARCHERO_USER_SESSION_TOKEN:\?Set ARCHERO_USER_SESSION_TOKEN\}/);
  assert.match(compose, /ARCHERO_DEPLOYMENT_ENV: production/);
  assert.doesNotMatch(compose, /ARCHERO_ENABLE_TEST_DATA_ADMIN/);
  assert.match(compose, /mem_limit: 2g/);
  assert.match(compose, /pids_limit: 256/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.doesNotMatch(compose, /tesseract|ADB|screenshots:\/app\/screenshots/i);
  assert.match(devCompose, /127\.0\.0\.1:\$\{ARCHERO_POSTGRES_PORT:-55440\}:5432/);
  assert.match(devCompose, /storage\/schema\.sql:\/docker-entrypoint-initdb\.d\/001-schema\.sql:ro/);
  assert.match(devCompose, /pg_isready -U archero -d archero_observer/);
  assert.match(testCompose, /internal: true/);
  assert.doesNotMatch(testCompose, /postgres-test-data/);
  assert.match(testCompose, /tmpfs:\s*\n\s*- \/var\/lib\/postgresql\/data/);
  assert.match(dockerfile, /org\.opencontainers\.image\.version=\$APP_VERSION/);
  assert.match(dockerfile, /ARG STRICT_DATABASE=1/);
  assert.match(dockerfile, /ARG TEST_DATA_ADMIN=0/);
  assert.match(dockerfile, /ARG DEPLOYMENT_ENV=production/);
  assert.match(dockerfile, /COPY --from=builder \/app\/web\/\.next\/server \.\/web\/\.next\/server/);
  assert.doesNotMatch(dockerfile, /tesseract-ocr/);
  assert.match(ocrCompose, /127\.0\.0\.1:\$\{ARCHERO_OCR_UI_PORT:-5190\}:5190/);
  assert.match(ocrCompose, /image: \$\{ARCHERO_OCR_IMAGE:-ghcr\.io\/cheark0x79\/archero-guild-ocr\}:\$\{ARCHERO_OCR_IMAGE_TAG:-latest\}/);
  assert.match(ocrDockerfile, /tesseract-ocr/);
  assert.match(publishWorkflow, /product: web/);
  assert.match(publishWorkflow, /product: ocr/);
  assert.match(publishWorkflow, /ghcr\.io\/\$\{GITHUB_REPOSITORY,,\}-\$\{\{ matrix\.product \}\}/);
  assert.match(makefile, /sh \.\/web\/scripts\/backup\.sh/);
  assert.match(backupScript, /pg_dump/);
  assert.match(backupScript, /pg_restore --list/);
  assert.match(backupScript, /tar -tzf/);
  assert.match(backupScript, /mktemp -d/);
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

test("environment examples cover Compose inputs and the configuration contract", () => {
  const configuration = fs.readFileSync(path.join(projectRoot, "docs", "configuration.md"), "utf8");
  const derivedComposeSettings = new Set(["ARCHERO_IMAGE_TAG"]);
  const products = [
    {
      compose: fs.readFileSync(path.join(projectRoot, "web", "compose.yml"), "utf8"),
      example: fs.readFileSync(path.join(projectRoot, "web", ".env.prod.example"), "utf8"),
    },
    {
      compose: fs.readFileSync(path.join(projectRoot, "ocr", "compose.yml"), "utf8"),
      example: fs.readFileSync(path.join(projectRoot, "ocr", ".env.example"), "utf8"),
    },
  ];
  const examples = [
    fs.readFileSync(path.join(projectRoot, "web", ".env.dev.example"), "utf8"),
    ...products.map((product) => product.example),
  ];

  for (const { compose, example } of products) {
    const exampleNames = environmentNames(example);
    for (const match of compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) {
      if (derivedComposeSettings.has(match[1])) continue;
      assert.ok(exampleNames.has(match[1]), `${match[1]} must appear in the matching environment example`);
    }
  }

  for (const example of examples) {
    for (const name of environmentNames(example)) {
      assert.ok(configuration.includes("`" + name + "`"), `${name} must be documented in docs/configuration.md`);
    }
  }
});

function environmentNames(content) {
  return new Set(
    [...content.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
  );
}
