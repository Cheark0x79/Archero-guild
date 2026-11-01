# Browser journeys

Use Node 22 and the committed lockfile. Install Chromium and its system libraries
once in the test environment (the second command may require system privileges):

```sh
npm --prefix web ci
cd web && npx playwright install --with-deps chromium
```

From the repository root:

```sh
make test-e2e
```

This starts and stops an isolated Next development server on `127.0.0.1:5113`.
It refuses local Next `.env` files, passes only synthetic session tokens, and
never supplies database or production configuration. Do not run alongside a
second Next process in the same worktree because `.next` belongs to this run.
`E2E_PORT` selects another loopback port. `EVIDENCE_DIR` selects the screenshot
and JSON report directory (default `/tmp/archero-browser-evidence`).
`PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` can select externally provisioned,
version-compatible browser tooling without downloading another browser.

The suite runs real Chromium at 1440×1000 and 390×844 for viewer and administrator
sessions. Dashboard, Members, a member profile, Boss, Records, and all principal
admin pages are checked through navigation, reload and browser back. Activity's
legacy redirect to Notifications is asserted explicitly. Sidebar links are
clicked where available; Records and the legacy Activity destination currently
have no sidebar link and are opened directly. Viewers must not see admin links;
restricted page requests must show the access-denied recovery path and restricted
API requests must return 403. Anonymous access must redirect to login/return 401.

Every journey records browser exceptions, console errors, failed requests and
HTTP failures, including missing JS/CSS bundles. It asserts no horizontal page
overflow and saves full-page screenshots for visual inspection. Synthetic
fixtures come from the repository's deterministic demo generator. Only dashboard
data and admin records/rules requests are intercepted (including automatic rules
persistence, which writes no database); page routing, assets and
permission enforcement are real. This suite covers browser journeys, not the
backend persistence contract or production image packaging. The separate
`make test` checks remain required before publication.

## Ranking PNG regression

Run against an isolated local Next server with synthetic authentication only:

```sh
ARCHERO_USER_SESSION_TOKEN=synthetic-ranking-test npm --prefix web run dev -- --port 5116
```

With Playwright and its Chromium browser installed in your test environment:

```sh
BASE_URL=http://127.0.0.1:5116 node web/browser-tests/ranking-export.mjs
```

`PLAYWRIGHT_MODULE` can point to an externally installed Playwright `index.mjs`;
`CHROMIUM_PATH` can select an installed Chromium executable. Set `EVIDENCE_DIR`
to save the actual downloaded PNGs, canvas text observations, and desktop/mobile
DOM screenshots. The browser intercepts the dashboard API with synthetic data;
no database, production credentials, or real member records are required.

The test exercises the Rankings tab and Export image button at 1440px and 390px,
including empty, partial podium, full podium, 4, 12, and 40 member rankings. It
checks the actual rendered canvas and downloaded PNG, preserving scores, ties,
ordinal ranks, the full member count, and all rows without pagination. It also
covers the individual-boss filter. Review the emitted screenshots for readability.
This browser check is separate from the default Node test suite.
