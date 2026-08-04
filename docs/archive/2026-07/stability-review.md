# Application stability review

> Status: historical review from July 2026. It is not a current operations
> runbook.

Last updated: 2026-07-28

## Objective

Stabilize the dashboard, import workflow, public API, and PostgreSQL data path
before deployment. The review focuses on data integrity, reload-safe import
status, duplicate handling, API security, truthful availability reporting, and
repeatable validation.

## Current assessment

| Surface | Earlier score | Current score | Evidence |
| --- | ---: | ---: | --- |
| Dashboard data workflow | 6/10 | 8/10 | Reload-safe job snapshots, five-second polling, and explicit duplicate warnings |
| Backend import job | 6/10 | 8/10 | Single active job, bounded history, redacted public state, and persisted snapshot |
| Local data integrity | 6/10 | 8.5/10 | Roster, snapshot, boss-rank, and weekly-reset invariants are tested |
| Public API integrity | 6/10 | 9/10 | Explicit provenance, no database/sample mixing, derived metrics, and PostgreSQL contract tests |
| API and data security | 5/10 | 8.5/10 | Action headers, strict dates, fail-closed production auth, rate limiting, and bounded PNG decoding |
| Deployment readiness | 5/10 | 8.5/10 | Production image, live HTTP contract, PostgreSQL 16 integration, and zero-vulnerability production audit |

## Implemented safeguards

### Import jobs

- `/api/data/import/status` exposes sanitized server-side progress.
- Public job objects never include raw `stdout`, `stderr`, or stack traces.
- At most one import job is active.
- Terminal history is bounded.
- `data/import-jobs/state.json` stores a best-effort status snapshot.
- Active jobs restored after a server restart are marked interrupted instead of
  pretending to still run.

### Screenshot uploads

- PNG signature and full decode validation.
- 15 MiB file limit and 12-million-pixel decode limit.
- SHA-256 digest.
- Exact duplicate detection for the same capture kind and date.
- Path containment under `screenshots/raw`.
- Recoverable discard workflow under `screenshots/trash`.

### Data persistence

- Atomic JSON report and local data writes.
- PostgreSQL persistence safety checks prevent unexpectedly small OCR imports
  from replacing larger existing datasets.
- Database mode never fills empty domains with local sample values.
- Rule updates use PostgreSQL when a database is configured.
- Legacy `data/rules.json` values migrate once when `rule_settings` is empty.
- Unknown metrics remain `null`.

### Public API

- Stable `/api/v1` paths, methods, parameters, and existing response fields.
- Additive `source`, `dataMode`, `partial`, and `missingDomains` metadata.
- Database-derived member deltas, boss identity, previous names, and aliases.
- Shared 15-second snapshot cache with single-flight exports.
- Cache invalidation after imports and rule changes.
- Production fails closed without `ARCHERO_API_KEYS`.
- Configurable per-key rate limiting.
- Canonical OpenAPI synchronized and checked by CI.

## Verification

```bash
python3 -B -m unittest discover -s tests
npm --prefix web test
npm --prefix web run openapi:check
npm --prefix web run build
```

Isolated PostgreSQL:

```bash
bash scripts/test-env.sh test
bash scripts/test-env.sh stop
```

See [`api-test-report.md`](api-test-report.md) for the latest counts and live
HTTP compatibility results.

## Remaining limitations

- An import child process continues when the browser reloads, but a full Next.js
  server restart cannot resume that process. A durable external worker queue
  would be required for automatic process recovery.
- API keys are configured through environment variables; there is no
  administrative key creation or revocation interface.
- The member history endpoint is not paginated.
- Signed webhook notifications and API access audit logs are not implemented.
- Production OCR still depends on platform-specific ADB and Tesseract access;
  staging must validate those hardware and filesystem assumptions.
