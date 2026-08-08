# Archero Observer

Archero Observer collects reviewed Archero guild data, stores it in PostgreSQL,
and exposes a dashboard plus a read-only API for integrations such as Discord
bots. Capture and OCR stay on a trusted workstation; the public server never
runs ADB, BlueStacks, or Tesseract.

## Products

| Product | Location | Runs on | Responsibility |
| --- | --- | --- | --- |
| Web platform | `platform/`, `web/` | Homelab server | Dashboard, API, PostgreSQL, temporary share links, Cloudflare Tunnel |
| OCR workstation | `ocr/`, `observer/ocr/` | Trusted Windows/WSL PC | Screenshot review, OCR, validation, publication |
| Observer tools | `observer/`, `scripts/` | Development workstation | Imports, migrations, tests, and maintenance |

The products exchange reviewed JSON through the versioned contract in
[`contracts/import-batch.schema.json`](contracts/import-batch.schema.json).
Raw screenshots do not leave the OCR workstation.

## Prerequisites

- Python 3.12 for observer and OCR tests;
- Node.js 22 for the web application;
- Docker Engine with Docker Compose v2 for PostgreSQL and deployments;
- Tesseract, ADB, and BlueStacks only on the OCR workstation.

`nix develop` provides the supported Linux development toolchain. Appium is
not part of the default environment.

## Quick start

Install the web dependencies and create the local configuration:

```bash
npm --prefix web ci
cp web/.env.local.example web/.env.local
npm --prefix web run dev
```

Open `http://127.0.0.1:5181`. The example starts in explicit demonstration
mode. Sign in with the local administrator values copied to `web/.env.local`.

To use PostgreSQL instead, start the local database and uncomment
`ARCHERO_DATABASE_URL` in `web/.env.local`:

```bash
docker compose up -d postgres
```

The local database listens on `127.0.0.1:55440` by default. It is never filled
with demonstration members when database mode is enabled.

### Synthetic Web fixtures

The local Web example enables deterministic synthetic fixtures even when an
isolated launcher injects a PostgreSQL URL. The fixture contains 40 fictional
identities, 21 member days, 21 boss days, and the complete seven-boss rotation.
It never reads or transforms a production export.

Set `ARCHERO_DEMO_SCENARIO` in the local environment to one of:

- `baseline`: complete, internally consistent data;
- `audit-anomalies`: controlled missing and mismatched boss identities;
- `record-variants`: equal scores and personal-record variations;
- `sparse`: missing metrics and unresolved fictional identities.

`ARCHERO_DEMO_SEED` reproduces a variant and `ARCHERO_DEMO_ANCHOR_DATE` moves
the generated 21-day window. Explicit demo mode is accepted only for an HTTP
loopback origin and is refused whenever `ARCHERO_REQUIRE_DATABASE=1`, as it is
in the production Compose stack.

## Common development commands

```bash
# Python unit tests
python -m unittest discover -s tests

# Web tests and documentation checks
npm --prefix web test
npm --prefix web run docs:check

# Production-style web build
npm --prefix web run build

# Isolated PostgreSQL integration tests on Windows
.\scripts\test-env.ps1 test
.\scripts\test-env.ps1 stop
```

Linux and WSL use `bash scripts/test-env.sh test` and
`bash scripts/test-env.sh stop`. Stop the foreground web server with `Ctrl+C`.

## OCR workstation

Configure and start the isolated OCR product:

```powershell
Copy-Item ocr/.env.example ocr/.env
Copy-Item ocr/targets.example.json ocr/targets.json
.\ocr\control.ps1 start
.\ocr\control.ps1 status
```

Open `http://127.0.0.1:5190`. See the
[OCR workstation guide](docs/deployment/ocr-workstation.md) before publishing
to pre-production or production.

## Production operations

The supported deployment is Docker Compose behind Cloudflare Tunnel:

```bash
cp platform/.env.example platform/.env.production
chmod 600 platform/.env.production
make start
make status
make logs
```

Use `make release` for a backup-first application update. Never run
`docker compose down -v`, `docker volume rm`, or
`docker system prune --volumes` against the production project: those commands
can destroy PostgreSQL data.

Follow the [homelab deployment guide](docs/deployment/homelab.md) for first
installation and [operations](docs/operations.md) for backups, updates,
restoration, and rollback.

## Configuration and persistent state

- `platform/.env.production`, `ocr/.env`, `ocr/targets.json`, and
  `web/.env.local` contain environment-specific values and are ignored by Git.
- PostgreSQL lives in the `archero-observer_postgres-data` Docker volume.
- Application files such as import state and exports live under `data/`.
- Raw captures and OCR outbox files remain on the trusted workstation.
- Backup archives live under `backups/` and must also be copied off the server.

See [configuration](docs/configuration.md) for setting ownership, defaults, and
secret rotation.

## Documentation

Start with the [documentation index](docs/README.md):

- [Architecture](docs/architecture.md)
- [Configuration contract](docs/configuration.md)
- [Operations runbook](docs/operations.md)
- [Public API](docs/api.md)
- [Canonical OpenAPI contract](docs/openapi.yaml)
- [Current homelab deployment](docs/deployment/homelab.md)

English is canonical for repository and API contracts. French operator guides
are kept under `docs/guides/fr/`.
