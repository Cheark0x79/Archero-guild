import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoData } from '../lib/demo-data.js';

// Own the server and its environment: never connect to an existing deployment.
const web = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  await assert.rejects(fs.access(path.join(web, name)), { code: 'ENOENT' });
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = Number(process.env.E2E_PORT || 5113);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const origin = `http://127.0.0.1:${port}`;
const output = path.resolve(process.env.EVIDENCE_DIR || '/tmp/archero-browser-evidence');
await fs.mkdir(output, { recursive: true });
const tokens = { viewer: 'synthetic-e2e-viewer', admin: 'synthetic-e2e-admin' };
const server = spawn(process.execPath, [path.join(web, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: web,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    ARCHERO_USER_SESSION_TOKEN: tokens.viewer, ARCHERO_ADMIN_SESSION_TOKEN: tokens.admin,
    NODE_OPTIONS: '--max-old-space-size=1024' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
let browser;
const results = [];
const data = createDemoData({ seed: 'browser-journeys', anchorDate: '2026-08-09', scenario: 'baseline' });
data.captures.guildName = 'Synthetic Browser Guild';
const common = [['/dashboard', data.captures.guildName || 'Dashboard'], ['/members', 'Members'], ['/boss', 'Boss'], ['/records', 'Records']];
const restricted = ['/admin', '/admin/members', '/admin/member-history', '/admin/notifications', '/admin/rules', '/admin/activity', '/activity'];
try {
  for (let attempt = 0; ; attempt++) {
    assert.equal(server.exitCode, null, serverLog);
    if (serverLog.includes('Ready in')) break;
    assert.ok(attempt < 180, 'Next server did not become ready');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  for (const [layout, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    for (const role of ['viewer', 'admin']) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      await context.addCookies([{ name: 'archero_session', value: tokens[role], url: origin }]);
      // Only data endpoints are substituted; documents, bundles and auth run normally.
      await context.route('**/api/dashboard-data', route => route.fulfill({ json: { data } }));
      if (role === 'admin') {
        await context.route('**/api/member-admin', route => route.fulfill({ json: { ok: true, records: {} } }));
        await context.route('**/api/data/rules', route => route.fulfill({ json: { ok: true, rules: data.rules } }));
      }
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      page.setDefaultNavigationTimeout(120_000);
      const errors = [];
      const ruleRequests = [];
      page.on('request', request => { if (new URL(request.url()).pathname === '/api/data/rules') ruleRequests.push(request.method()); });
      page.on('pageerror', error => errors.push(`page: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
      page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
      page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`request: ${request.url()} ${request.failure()?.errorText}`); });
      async function verify(url, title) {
        await page.waitForURL(`${origin}${url}`);
        await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor();
        await page.waitForFunction(() => !document.body.textContent.includes('Loading guild data'));
        assert.equal(await page.locator('main').count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${layout} overflow at ${url}`);
      }
      const routes = [...common, ...(role === 'admin' ? [['/admin', 'Admin overview'], ['/admin/members', 'Member management'], ['/admin/member-history', 'Member history'], ['/admin/notifications', 'Notifications'], ['/admin/rules', 'Rules'], ['/admin/activity', 'Notifications'], ['/api-docs', 'API documentation']] : [])];
      for (const [url, title] of routes) {
        await page.goto(`${origin}/dashboard`);
        const menu = page.getByRole('button', { name: 'Menu', exact: true });
        if (await menu.isVisible()) await menu.click();
        const link = page.locator(`.sidebar a[href="${url}"]`).first();
        if (url !== '/dashboard' && await link.count()) await link.click();
        else await page.goto(`${origin}${url}`);
        await verify(url, title);
        await page.reload();
        await verify(url, title);
        await page.screenshot({ path: path.join(output, `${layout}-${role}-${url.slice(1).replaceAll('/', '-')}.png`), fullPage: true });
        await page.goto(`${origin}${url === '/boss' ? '/members' : '/boss'}`);
        await page.goBack();
        await verify(url, title);
        results.push({ layout, role, url, navigation: 'pass', reload: 'pass', back: 'pass' });
      }
      await page.goto(`${origin}/members`);
      const profile = page.locator('a[href^="/members/"]').first();
      await profile.waitFor();
      const memberURL = await profile.getAttribute('href');
      await profile.click();
      await page.waitForURL(`${origin}${memberURL}`);
      await page.getByRole('heading', { name: /^Demo/, level: 1 }).waitFor();
      const name = await page.locator('h1').textContent();
      assert.match(name, /^Demo/);
      await page.reload();
      await verify(memberURL, name);
      await page.screenshot({ path: path.join(output, `${layout}-${role}-member-detail.png`), fullPage: true });
      await page.goBack();
      await verify('/members', 'Members');
      results.push({ layout, role, url: memberURL, navigation: 'pass', reload: 'pass', back: 'pass' });
      if (role === 'viewer') {
        assert.equal(await page.locator('.sidebar a[href^="/admin"]').count(), 0);
        assert.deepEqual(ruleRequests, [], 'Viewer must use dashboard rules without requesting private rule storage');
        for (const url of restricted) {
          await page.goto(`${origin}${url}`);
          await verify('/access-denied', 'Access denied');
          await page.getByRole('link', { name: 'Return to Dashboard' }).click();
          await verify('/dashboard', common[0][1]);
        }
        for (const url of ['/api/member-admin', '/api/data/rules', '/api/member-share', '/api/warning-actions']) {
          assert.equal((await context.request.get(`${origin}${url}`)).status(), 403, url);
        }
      } else {
        await page.goto(`${origin}/activity`);
        await verify('/admin/activity', 'Notifications');
      }
      assert.deepEqual(errors, [], `${layout}/${role} browser failures`);
      console.log(`PASS ${layout}/${role}: navigation, reload, back, layout and permissions`);
      await context.close();
    }
  }
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(`${origin}/api/member-admin`)).status(), 401);
  const page = await anonymous.newPage();
  await page.goto(`${origin}/admin`);
  await page.waitForURL(`${origin}/login`);
  await anonymous.close();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
  await fs.writeFile(path.join(output, 'server.txt'), serverLog);
}
