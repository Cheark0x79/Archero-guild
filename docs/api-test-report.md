# API v1 compatibility test report

Last updated: 2026-07-28

## Scope

The compatibility audit covers every existing API route, with live HTTP checks
focused on the public Discord integration surface:

- health and guild summary;
- member list, filtering, pagination, resolution, detail, and history;
- member boss profile;
- violations and member rankings;
- boss catalog, daily results, and rankings;
- authentication, fail-closed production behavior, and rate limiting;
- PostgreSQL provenance and absence of demonstration-data leakage.

## Route and parameter compatibility

The current worktree was compared mechanically with `HEAD`.

| Contract item | Before | After | Result |
| --- | ---: | ---: | --- |
| `route.js` files | 33 | 33 | No route added, removed, or moved |
| HTTP methods | 33 route contracts | 33 route contracts | No method removed or changed |
| OpenAPI path/query parameters | 24 | 24 | Same names, locations, constraints, and defaults |
| Deleted response fields | 0 | 0 | Existing fields remain available |

New metadata and boss provenance fields are additive.

## Automated results

| Test layer | Result |
| --- | ---: |
| JavaScript unit and contract tests | 78/78 passed |
| Python test suite | 91 passed; 9 integration tests skipped without a configured database |
| PostgreSQL 16 contract tests | 3/3 passed |
| Live HTTP API scenarios | 24/24 passed |
| Production Docker image | Built successfully |
| npm production dependency audit | 0 known vulnerabilities |

## Live HTTP scenarios

The 24 scenarios ran against the production Docker image with explicit
demonstration mode and an API key. They cover:

- health success envelope;
- member pagination, name search, and former-member filtering;
- invalid member status;
- exact Player ID, normalized-name, alias, and typo resolution;
- missing resolver query;
- existing and unknown member details;
- violation filtering and invalid severity;
- ascending and descending member rankings;
- invalid ranking metrics;
- boss results filtered by date and player;
- invalid and impossible calendar dates;
- member boss profile and unknown member behavior;
- inverted history date ranges;
- invalid and non-Monday weekly ranking dates.

## Security behavior

| Scenario | Expected and observed result |
| --- | --- |
| `/api/v1/health` without a key | `200` |
| Protected route with valid Bearer token | `200` |
| Protected route with valid `X-API-Key` | `200` |
| Protected route without a configured production key | `503 api_not_configured` |
| Third request with a temporary two-request limit | `429 rate_limited` with `Retry-After` |

The rate limiter is keyed by a non-reversible fingerprint of the configured API
key. The raw key is not stored in limiter state.

## PostgreSQL contract

The isolated integration test applies the real schema, inserts a dedicated
member and three snapshots, stores a boss result and rules, then verifies:

- no sample member ID appears in a database export;
- power, contribution, boss-attempt, and 14-day growth values are derived from
  real history;
- boss damage and boss identity use stored PostgreSQL records;
- rules round-trip through `rule_settings`;
- previous names come from `member_names`;
- aliases come from `guild_members.metadata`.

## Intentional semantic changes

These changes preserve field names but improve truthfulness or security:

| Previous behavior | Current behavior | Consumer requirement |
| --- | --- | --- |
| Missing aggregate could look like `0` | Unknown aggregate is `null` | Accept nullable numeric fields |
| PostgreSQL failure could expose sample data | Empty unavailable payload with provenance | Handle `dataMode: unavailable` |
| Production without API keys was open | Protected routes return `503` | Configure `ARCHERO_API_KEYS` |
| Impossible internal dates matched the shape | Impossible dates return `400` | Send real calendar dates |
| Unlimited public requests | Default 120 requests per minute per key | Honor `429` and `Retry-After` |

## Non-destructive test boundary

Live tests do not trigger physical capture, upload, discard, or import actions.
Those mutation routes are covered through validators and unit tests so the
compatibility audit does not alter user screenshots or production data.

All database writes occur only inside the isolated test Compose project.
