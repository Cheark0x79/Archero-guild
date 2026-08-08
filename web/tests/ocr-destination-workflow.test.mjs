import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../../ocr/ui/app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../../ocr/ui/index.html", import.meta.url), "utf8");

test("OCR browser application has valid JavaScript syntax", () => {
  assert.doesNotThrow(() => new Function(appSource));
});

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

test("destination credentials are managed in the loopback UI without prefilled secrets", () => {
  assert.match(htmlSource, /id="target-url" type="url"/);
  assert.match(htmlSource, /id="target-token" type="password"/);
  assert.doesNotMatch(htmlSource, /id="target-token"[^>]*value=/);
  assert.match(appSource, /request\("\/api\/targets"/);
  assert.match(appSource, /state\.status\?\.targets/);
});

test("local review is the reload default", () => {
  assert.match(
    appSource,
    /visibleTargets\.find\(\(target\) => target\.key === "local"\)/,
  );
});

test("roster synchronization is explicit and reports no publication", () => {
  assert.match(htmlSource, /id="sync-roster"/);
  assert.match(appSource, /request\("\/api\/roster\/sync"/);
  assert.match(appSource, /No OCR batch was published/);
});

test("boss review never asks for a player ID", () => {
  const bossColumnsStart = appSource.indexOf("const BOSS_COLUMNS = [");
  const bossColumnsEnd = appSource.indexOf("];", bossColumnsStart);
  assert.ok(bossColumnsStart >= 0 && bossColumnsEnd > bossColumnsStart);
  assert.doesNotMatch(appSource.slice(bossColumnsStart, bossColumnsEnd), /Player ID|playerId/);
});

test("export uses a confirmation dialog and no typed phrase", () => {
  assert.match(htmlSource, /id="export-dialog"/);
  assert.match(htmlSource, /id="confirm-export"/);
  assert.doesNotMatch(htmlSource, /id="confirmation"/);
  assert.doesNotMatch(htmlSource, /id="previous-step"|id="next-step"/);
  assert.match(appSource, /Members and Boss together/);
  assert.match(htmlSource, /id="confirm-export-date"/);
  assert.match(appSource, /I confirm the data date/);
  assert.match(htmlSource, /id="publish-success"/);
  assert.match(htmlSource, /id="refresh-history"/);
  assert.match(appSource, /\/api\/import-history\?target=/);
});

test("onboarding guides both local reviews before the destination", () => {
  assert.match(htmlSource, /data-go-step="1"[^>]*>.*Members/);
  assert.match(htmlSource, /data-go-step="2"[^>]*>.*Review members/);
  assert.match(htmlSource, /data-go-step="3"[^>]*>.*Boss/);
  assert.match(htmlSource, /data-go-step="4"[^>]*>.*Review boss/);
  assert.match(htmlSource, /data-go-step="5"[^>]*>.*Destination/);
  assert.match(htmlSource, /id="upload-kind" type="hidden" value="guild-members"/);
  assert.match(appSource, /images\[0\]\.kind === "guild-boss" \? 4 : 2/);
  assert.match(appSource, /new Set\(\[1, 2\]\)/);
  assert.match(appSource, /new Set\(\[3\]\)/);
  assert.doesNotMatch(htmlSource, /id="upload-kind"[^>]*<option/);
});

test("local session date is independent from the final export date", () => {
  assert.match(appSource, /sessionDate: activeSessionDate\(\)/);
  assert.match(appSource, /localStorage\.getItem\("archero-ocr-session-date"\)/);
  assert.match(appSource, /date: \$\("capture-date"\)\.value,\s*sessionDate: activeSessionDate\(\)/);
  assert.doesNotMatch(appSource, /setCaptureDate\(captureDate\);\s*state\.images = \[\]/);
});

test("only local and configured destinations are shown", () => {
  assert.match(appSource, /target\.mode === "local" \|\| target\.configured/);
  assert.match(htmlSource, /id="reset-session"[^>]*>Clear Members/);
  assert.match(htmlSource, /Link the local ID cache to/);
  assert.doesNotMatch(appSource, /configuration required/);
});
