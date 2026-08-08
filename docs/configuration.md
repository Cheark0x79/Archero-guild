# Configuration contract

This document defines who owns every operator-facing setting. Runtime code is
authoritative for parsing and validation; Compose is authoritative for how
production values reach each process.

## Configuration files

| File | Product and environment | Committed |
| --- | --- | --- |
| `.env.example` | Python tools and local PostgreSQL | Example only |
| `web/.env.local.example` | Native Next.js development | Example only |
| `platform/.env.example` | Production or pre-production platform | Example only |
| `ocr/.env.example` | Local OCR container paths and port | Example only |
| `ocr/targets.example.json` | Remote OCR destinations and credentials | Example only |

Real `.env`, `.env.production`, `.env.local`, `ocr/.env`, and
`ocr/targets.json` files are ignored by Git. Restrict production files to the
operator account (`chmod 600` on Linux).

## Local database and Python tools

| Setting | Class | Meaning |
| --- | --- | --- |
| `ARCHERO_POSTGRES_PORT` | Optional, default `55440` | Loopback port published by the local PostgreSQL Compose service |
| `ARCHERO_DATABASE_URL` | Conditional | Preferred PostgreSQL DSN for imports, migrations, and exports |
| `DATABASE_URL` | Conditional alias | Used only when `ARCHERO_DATABASE_URL` is absent |
| `ARCHERO_REQUIRE_DATABASE` | Deployment-owned | `1` makes database availability mandatory; production Compose owns it |
| `ARCHERO_ALLOW_PARTIAL_REPLACEMENT` | Emergency override | Allows a suspiciously smaller import to replace existing data; leave unset normally |

## Native web development

| Setting | Class | Meaning |
| --- | --- | --- |
| `ARCHERO_PUBLIC_ORIGIN` | Required public value | Exact browser-facing HTTP(S) origin, without a path |
| `ARCHERO_ADMIN_USERNAME` | Optional, default `admin` | Local administrator login name |
| `ARCHERO_ADMIN_PASSWORD` | Required secret | Administrator password |
| `ARCHERO_ADMIN_SESSION_TOKEN` | Required secret | Independent administrator session token |
| `ARCHERO_USER_USERNAME` | Optional, default `viewer` | Standard user login name |
| `ARCHERO_USER_PASSWORD` | Optional local secret | Enables the standard user account when paired with its token |
| `ARCHERO_USER_SESSION_TOKEN` | Optional local secret | Standard user session token |
| `ARCHERO_API_KEYS` | Optional locally | Comma-separated server-side API keys; required in production |
| `ARCHERO_SHARE_LINK_SECRET` | Required secret | At least 32 bytes; signs temporary member links |
| `ARCHERO_INGESTION_KEYS` | Conditional secret | Required only when testing remote ingestion locally |
| `ARCHERO_DATA_CACHE_TTL_MS` | Optional, default `15000` | Successful database export cache duration, maximum 300000 ms |
| `ARCHERO_DATA_ERROR_CACHE_TTL_MS` | Optional, default `2000` | Failed export cache duration, maximum 300000 ms |
| `ARCHERO_API_RATE_LIMIT_PER_MINUTE` | Optional, default `120` | Per-principal API limit; `0` disables it |
| `ARCHERO_DATA_MODE` | Local test only | Set to `demo` to force synthetic fixtures on a loopback origin; refused by strict database mode |
| `ARCHERO_DEMO_SEED` | Local test only | Stable seed used to reproduce the same fictional identities and metrics |
| `ARCHERO_DEMO_ANCHOR_DATE` | Local test only | Final fixture date in `YYYY-MM-DD` format; twenty preceding days are generated |
| `ARCHERO_DEMO_SCENARIO` | Local test only | Synthetic variant: `baseline`, `audit-anomalies`, `record-variants`, or `sparse` |

Comment out both database URL variables to use explicit demonstration mode.
Database mode never falls back to demonstration data.

## Platform deployment

| Setting | Class | Meaning |
| --- | --- | --- |
| `ARCHERO_DASHBOARD_PORT` | Optional, default `5181` | Host loopback port |
| `ARCHERO_BIND_ADDRESS` | Optional, default `127.0.0.1` | Host bind address; keep loopback behind Cloudflare |
| `POSTGRES_DB` | Optional, default `archero_observer` | PostgreSQL database name |
| `POSTGRES_USER` | Optional, default `archero` | PostgreSQL role |
| `POSTGRES_PASSWORD` | Required secret | Dedicated database password |
| `CLOUDFLARE_TUNNEL_TOKEN` | Required secret | Remotely managed tunnel token |

The platform also requires all web secrets listed above, including distinct
user, administrator, API, share-link, and ingestion credentials.
`ARCHERO_IMAGE_TAG` is derived from `VERSION` or `.release-version` by the
Makefile and does not belong in an environment example.

## OCR workstation

| Setting | Class | Meaning |
| --- | --- | --- |
| `ARCHERO_AGENT_VERSION` | Optional, default `development` | Version reported with an import batch |
| `ARCHERO_OCR_UI_PORT` | Optional, default `5190` | Loopback review UI port |
| `ARCHERO_CAPTURE_ROOT` | Optional | Host capture directory mounted at `/captures` |
| `ARCHERO_OUTBOX_ROOT` | Optional | Host reviewed-batch directory mounted at `/outbox` |
| `ARCHERO_OCR_TARGETS_FILE` | Required path | Private target JSON writable only by the local OCR service |
| `ARCHERO_OCR_ROSTER_CACHE` | Optional path | Private cache of player IDs explicitly synchronized from a destination; defaults next to the target file |
| `ARCHERO_TARGET_URL` | Conditional CLI value | Legacy CLI profile destination; the UI uses `targets.json` |
| `ARCHERO_INGESTION_TOKEN` | Conditional CLI secret | Legacy CLI profile ingestion token |
| `CF_ACCESS_CLIENT_ID` | Conditional secret identifier | Cloudflare service token ID for CLI publication |
| `CF_ACCESS_CLIENT_SECRET` | Conditional secret | Cloudflare service token secret for CLI publication |

Create remote destinations from the loopback-only review UI. Every environment
must use a dedicated ingestion key. Cloudflare Access credentials are optional
advanced values and are unnecessary when the application ingestion API is
directly reachable. Keep target secrets in the ignored private OCR storage, not
in `ocr/.env` or Git.

## Internal and test-only settings

`ARCHERO_NEXT_OUTPUT`, `ARCHERO_API_TEST_URL`, `ARCHERO_API_TOKEN`,
`NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_LOCAL_OCR_ENABLED`, `ARCHERO_PYTHON`,
`ARCHERO_OCR_UI_ROOT`, `ARCHERO_PROGRESS`, `ARCHERO_RULES_FILE`, and
`ARCHERO_WSL_DISTRO` are owned by builds, tests, wrappers, or internal runtime
adapters. They are intentionally absent from operator examples.

## Rotation

- Rotate one credential purpose at a time; never reuse a value across roles.
- Recreate the affected application container after changing platform values.
- Rotating session tokens invalidates existing sessions.
- Rotating `ARCHERO_SHARE_LINK_SECRET` immediately invalidates every temporary
  member link.
- Rotate ingestion keys on the platform and matching OCR target together.
- Never print current secret values in logs, support messages, or screenshots.
