# Configuration contract

This document defines who owns every operator-facing setting. Runtime code is
authoritative for parsing and validation; Compose is authoritative for how
production values reach each process.

## Configuration files

| File | Product and environment | Committed |
| --- | --- | --- |
| `web/.env.dev.example` | Web development and local PostgreSQL | Example only |
| `web/.env.prod.example` | Generic production deployment | Example only |
| `ocr/.env.example` | Local OCR container paths and port | Example only |
| `ocr/targets.example.json` | Remote OCR destinations and credentials | Example only |

Real `web/.env.development.local`, `web/.env.prod`, `ocr/.env`, and
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
| `ARCHERO_DEPLOYMENT_ENV` | Required environment class | `development`, `test`, or `production`; synthetic database controls require `development` or `test` |
| `ARCHERO_DEMO_SEED` | Local test only | Stable seed used to reproduce the same fictional identities and metrics |
| `ARCHERO_DEMO_ANCHOR_DATE` | Local test only | Final fixture date in `YYYY-MM-DD` format; twenty preceding days are generated |
| `ARCHERO_DEMO_SCENARIO` | Local test only | Synthetic variant: `baseline`, `audit-anomalies`, `record-variants`, or `sparse` |
| `ARCHERO_ENVIRONMENT_ID` | Isolated test only | Launcher-owned identity matching `t-*`; required by the administrator test-data loader |
| `ARCHERO_ENABLE_TEST_DATA_ADMIN` | Isolated test only | Enables synthetic PostgreSQL load/clear only in development/test mode with a loopback origin, a `t-*` identity, and non-strict database mode |

Comment out both database URL variables to use explicit demonstration mode.
Database mode never falls back to demonstration data.

## Web deployment

| Setting | Class | Meaning |
| --- | --- | --- |
| `ARCHERO_DASHBOARD_PORT` | Optional, default `5181` | Host loopback port |
| `ARCHERO_BIND_ADDRESS` | Optional, default `127.0.0.1` | Host bind address; change only when deliberate LAN or proxy access is required |
| `ARCHERO_WEB_IMAGE` | Optional, default `ghcr.io/cheark0x79/archero-guild-web` | Published Web/API image; override only for an intentional mirror or custom build |
| `ARCHERO_IMAGE_TAG` | Optional, default `latest` | Published Web/API image tag; `make` defaults it to the pinned repository `VERSION` |
| `POSTGRES_DB` | Optional, default `archero_observer` | PostgreSQL database name |
| `POSTGRES_USER` | Optional, default `archero` | PostgreSQL role |
| `POSTGRES_PASSWORD` | Required secret | Dedicated database password |

The Web/API application also requires all web secrets listed above, including distinct
user, administrator, API, share-link, and ingestion credentials.
`ARCHERO_IMAGE_TAG` defaults to `latest` for direct Compose use. The Makefile
uses the version recorded in `VERSION`; set `IMAGE_TAG=<version>` for a
specific published release.

## OCR workstation

| Setting | Class | Meaning |
| --- | --- | --- |
| `ARCHERO_AGENT_VERSION` | Optional, default `development` | Version reported with an import batch |
| `ARCHERO_OCR_IMAGE` | Optional, default `ghcr.io/cheark0x79/archero-guild-ocr` | Published OCR workstation image; override only for an intentional mirror or local build |
| `ARCHERO_OCR_IMAGE_TAG` | Optional, default `latest` | OCR image release; the example pins the repository `VERSION` for reproducible workstation updates |
| `ARCHERO_OCR_UI_PORT` | Optional, default `5190` | Loopback review UI port |
| `ARCHERO_OCR_UID` | Optional, default `1000` | UID used for writable OCR workstation host mounts; use `id -u` on WSL when it differs |
| `ARCHERO_OCR_GID` | Optional, default `1000` | GID used for writable OCR workstation host mounts; use `id -g` on WSL when it differs |
| `ARCHERO_CAPTURE_ROOT` | Optional | Host capture directory mounted at `/captures` |
| `ARCHERO_OUTBOX_ROOT` | Optional | Host reviewed-batch directory mounted at `/outbox` |
| `ARCHERO_OCR_TARGETS_FILE` | Required path | Private target JSON writable only by the local OCR service |
| `ARCHERO_OCR_ROSTER_CACHE` | Optional path | Private cache of player IDs explicitly synchronized from a destination; defaults next to the target file |
Create remote destinations from the loopback-only review UI. Every environment
must use a dedicated ingestion key. Keep target secrets in the ignored private
OCR storage, not in `ocr/.env` or Git.

## Internal and test-only settings

`ARCHERO_NEXT_OUTPUT`, `ARCHERO_API_TEST_URL`, `ARCHERO_API_TOKEN`,
`NEXT_PUBLIC_APP_VERSION`,
`NEXT_PUBLIC_TEST_DATA_ADMIN`, `NEXT_PUBLIC_DEPLOYMENT_ENV`, `ARCHERO_PYTHON`,
`ARCHERO_OCR_UI_ROOT`, `ARCHERO_PROGRESS`, and `ARCHERO_RULES_FILE` are owned
by builds, tests, or internal runtime
adapters. They are intentionally absent from operator examples.

## Rotation

- Rotate one credential purpose at a time; never reuse a value across roles.
- Recreate the affected Web/API container after changing application values.
- Rotating session tokens invalidates existing sessions.
- Rotating `ARCHERO_SHARE_LINK_SECRET` immediately invalidates every temporary
  member link.
- Rotate ingestion keys on the Web/API application and matching OCR target together.
- Never print current secret values in logs, support messages, or screenshots.
