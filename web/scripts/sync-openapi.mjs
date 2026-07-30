import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(webRoot, "..", "docs", "openapi.yaml");
const destination = path.resolve(webRoot, "public", "openapi.yaml");
const checkOnly = process.argv.includes("--check");
const canonical = await fs.readFile(source);

if (checkOnly) {
  const published = await fs.readFile(destination).catch(() => null);
  if (!published || !canonical.equals(published)) {
    console.error("web/public/openapi.yaml is out of sync. Run: npm run openapi:sync");
    process.exitCode = 1;
  }
} else {
  await fs.writeFile(destination, canonical);
  console.log(`Synchronized ${path.relative(webRoot, source)} -> ${path.relative(webRoot, destination)}`);
}
