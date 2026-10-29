# Ranking PNG regression

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
