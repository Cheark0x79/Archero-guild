// Run against an isolated Next server with ARCHERO_USER_SESSION_TOKEN=synthetic-ranking-test.
// PLAYWRIGHT_MODULE may point to an externally installed playwright entrypoint.
// EVIDENCE_DIR receives real DOM screenshots and downloaded PNGs; no database is used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseURL = process.env.BASE_URL || "http://127.0.0.1:5116";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname), "Use an isolated local server");
const output = process.env.EVIDENCE_DIR;
if (output) await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

function fixture(count) {
  const roster = Array.from({ length: count }, (_, index) => ({
    playerId: `900000${String(index).padStart(3, "0")}`,
    name: `Demo${String(index + 1).padStart(2, "0")}`,
    status: "active",
    role: "member",
  }));
  // Equal scores straddle the podium boundary. Reverse source order to exercise sorting.
  const scores = roster.map((_, index) => index === 3 ? 98 : 100 - index);
  const rows = roster.map((member, index) => ({ ...member, bossDamageToday: scores[index] * 1_000_000 })).reverse();
  return {
    names: roster.map((member) => member.name), scores: scores.map((value) => `${value}M`),
    data: { guildRoster: roster, memberSnapshots: roster, dailyBossRawSnapshots: [
      { date: "2026-08-09", bossKey: "grim-reaper", rows },
    ] },
  };
}

try {
  for (const [label, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
    for (const count of [12, 0, 1, 2, 3, 4, 40]) {
      const { names, scores, data } = fixture(count);
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      await context.addCookies([{ name: "archero_session", value: "synthetic-ranking-test", url: baseURL }]);
      await context.route("**/api/dashboard-data", (route) => route.fulfill({ json: { data } }));
      // Observe real canvas text drawing without replacing rendering or encoding.
      await context.addInitScript(() => {
        window.exportText = [];
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
          window.exportText.push({ text, x, y });
          return original.call(this, text, x, y, ...rest);
        };
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${baseURL}/boss`);
      await page.getByRole("tab", { name: "Rankings", exact: true }).click();
      const panel = page.locator(".boss-alltime-panel");
      await panel.waitFor();
      await page.waitForFunction((expected) => document.querySelectorAll(".boss-alltime-panel .boss-podium-card").length === Math.min(expected, 3), count);
      assert.deepEqual(await panel.locator(".boss-podium-copy strong").allTextContents(), names.slice(0, 3));
      const remainder = label === "desktop"
        ? panel.locator(".boss-ranking-table tbody tr:not(:has(.table-empty-state)) td:nth-child(2)")
        : panel.locator(".boss-ranking-mobile-list article > div > strong");
      assert.deepEqual(await remainder.allTextContents(), names.slice(3));
      if (output && count === 12) await panel.screenshot({ path: path.join(output, `${label}-dom.png`) });
      if (count === 0) {
        assert.equal(await panel.getByRole("button", { name: "Export image" }).isDisabled(), true);
      } else {
        for (const scope of count === 12 ? ["all", "grim-reaper"] : ["all"]) {
          await panel.locator("select").selectOption(scope);
          await page.evaluate(() => { window.exportText = []; });
          const downloadPromise = page.waitForEvent("download");
          await panel.getByRole("button", { name: "Export image" }).click();
          const download = await downloadPromise;
          assert.match(download.suggestedFilename(), new RegExp(`^archero-boss-ranking-${scope}-.*\\.png$`));
          const png = await fs.readFile(await download.path());
          const text = await page.evaluate(() => window.exportText);
          if (output && count === 12) {
            await fs.writeFile(path.join(output, `${label}-${scope}.png`), png);
            await fs.writeFile(path.join(output, `${label}-${scope}-text.json`), JSON.stringify(text, null, 2));
          }
          assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
          for (const name of names) assert.equal(text.filter((item) => item.text === name).length, 1, `${label}: ${name} must occur once`);
          // Canvas podium is visually 2,1,3; table continues at 4, without pagination/truncation.
          const drawnNames = text.filter((item) => names.includes(item.text)).map((item) => item.text);
          assert.deepEqual(drawnNames, [names[1], names[0], names[2], ...names.slice(3)].filter(Boolean));
          const drawnScores = text.filter((item) => /^\d+M$/.test(item.text)).map((item) => item.text);
          assert.deepEqual(drawnScores, [scores[1], scores[0], scores[2], ...scores.slice(3)].filter(Boolean));
          const tableRanks = text.filter((item) => item.y > 562 && /^\d+$/.test(item.text)).map((item) => item.text);
          assert.deepEqual(tableRanks, Array.from({ length: Math.max(0, count - 3) }, (_, index) => String(index + 4)));
          assert.equal(png.readUInt32BE(16), 1800);
          assert.equal(png.readUInt32BE(20), 682 + Math.max(0, count - 3) * 70);
          assert.ok(text.some((item) => item.text.includes(`${count} guild member`)), "Header counts all members");
        }
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${label}: ${count} members, DOM and PNG order/scores/unique members`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
