import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const documentationRoots = [
  path.join(repositoryRoot, "README.md"),
  path.join(repositoryRoot, "docs"),
  path.join(repositoryRoot, "observer", "storage", "README.md"),
];

const markdownFiles = [];
for (const root of documentationRoots) {
  const entry = await fs.stat(root);
  if (entry.isDirectory()) await collectMarkdown(root, markdownFiles);
  else markdownFiles.push(root);
}

const failures = [];
const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const content = await fs.readFile(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    const target = rawTarget.split(/\s+["']/)[0].split("#")[0].split("?")[0];
    if (!target || /^(?:[a-z]+:|#|\/)/i.test(target)) continue;

    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    try {
      await fs.access(resolved);
    } catch {
      failures.push(`${path.relative(repositoryRoot, file)} -> ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken documentation links:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${markdownFiles.length} Markdown files: all local links resolve.`);
}

async function collectMarkdown(directory, output) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectMarkdown(absolute, output);
    else if (entry.isFile() && entry.name.endsWith(".md")) output.push(absolute);
  }
}
