import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../../ocr/ui/app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../../ocr/ui/index.html", import.meta.url), "utf8");

function dateHelpers() {
  const start = appSource.indexOf("function formatFrenchDate(");
  const end = appSource.indexOf("\nasync function request(", start);
  assert.ok(start >= 0 && end > start);
  return Function(`${appSource.slice(start, end)}; return { formatFrenchDate, parseFrenchDate };`)();
}

test("OCR dates are displayed and parsed as DD/MM/YYYY", () => {
  const { formatFrenchDate, parseFrenchDate } = dateHelpers();

  assert.equal(formatFrenchDate("2026-07-30"), "30/07/2026");
  assert.equal(parseFrenchDate("30/07/2026"), "2026-07-30");
  assert.equal(parseFrenchDate("07/30/2026"), null);
  assert.equal(parseFrenchDate("31/02/2026"), null);
});

test("destination credentials cannot be edited from the publishing workflow", () => {
  assert.doesNotMatch(htmlSource, /id="(?:target-url|target-token|save-target)"/);
  assert.doesNotMatch(appSource, /\$\("(?:target-url|target-token|save-target)"\)/);
  assert.match(htmlSource, /id="target-summary"/);
});

test("configured pre-production is the reload default", () => {
  assert.match(
    appSource,
    /payload\.targets\.find\(\(target\) => target\.key === "preprod" && target\.configured\)/,
  );
});

test("boss review never asks for a player ID", () => {
  const bossColumnsStart = appSource.indexOf("const BOSS_COLUMNS = [");
  const bossColumnsEnd = appSource.indexOf("];", bossColumnsStart);
  assert.ok(bossColumnsStart >= 0 && bossColumnsEnd > bossColumnsStart);
  assert.doesNotMatch(appSource.slice(bossColumnsStart, bossColumnsEnd), /Player ID|playerId/);
});
