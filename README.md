# Archero Guild

Archero Guild collects reviewed Archero guild data, stores it in PostgreSQL,
and exposes a dashboard plus a read-only API for integrations such as Discord
bots. Screenshots are uploaded to the trusted OCR workstation; the public
server never receives raw images or runs Tesseract.

## Products

| Product | Location | Runs on | Responsibility |
| --- | --- | --- | --- |
| Web and API | `web/` | Any Docker host | Dashboard, HTTP API, PostgreSQL, and container packaging |
| OCR workstation | `ocr/` | Trusted Windows/WSL PC | Screenshot upload, OCR, human review, validation, and publication |

The products exchange reviewed JSON through the versioned contract in
[`docs/contracts/import-batch.schema.json`](docs/contracts/import-batch.schema.json).
Raw screenshots do not leave the OCR workstation.

## Prerequisites

- Node.js 22 for the web application;
- Docker Engine with Docker Compose v2 for PostgreSQL and deployments;
- Tesseract inside the OCR workstation container.

## Quick start

Install the web dependencies and create the local configuration:

```bash
npm --prefix web ci
cp web/.env.dev.example web/.env.development.local
npm --prefix web run dev
```

Open `http://127.0.0.1:5181`. The example starts in explicit demonstration
mode. Sign in with the local administrator values copied to `web/.env.development.local`.

To use PostgreSQL instead, start the local database and uncomment
`ARCHERO_DATABASE_URL` in `web/.env.development.local`:

```bash
docker compose --env-file web/.env.development.local \
  -f web/compose.dev.yml up -d postgres
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
make doctor
make test
```

`make test` runs the Python and Web unit tests, documentation checks, and the
disposable PostgreSQL integration tests.

## OCR workstation

Configure and start the isolated OCR product:

```bash
cp ocr/.env.example ocr/.env
cp ocr/targets.example.json ocr/targets.json
docker compose --env-file ocr/.env -f ocr/compose.yml up -d --build --wait ui
docker compose --env-file ocr/.env -f ocr/compose.yml ps
```

Open `http://127.0.0.1:5190`. See the
[OCR workstation documentation](ocr/README.md) before publishing to a remote
Web/API deployment.

## Docker deployment

The generic Docker Compose stack runs the Web/API application and PostgreSQL:

```bash
cp web/.env.prod.example web/.env.prod
chmod 600 web/.env.prod
make start
make status
make logs
```

Run `make backup` before updating an installation. Never run
`docker compose down -v`, `docker volume rm`, or
`docker system prune --volumes` against the production project: those commands
can destroy PostgreSQL data.

Follow [operations](docs/operations.md) for backups, updates, restoration, and
rollback. Public ingress and reverse proxies are deliberately outside the
open-source stack.

`make start` pulls the version from `VERSION` from GHCR and waits for both the
Web/API and PostgreSQL health checks. To build the current checkout locally
instead, run:

```bash
make build
```

For a published OCR workstation image, use the same canonical launcher after
copying the example files:

```bash
make ocr-prepare
make ocr-start
make ocr-status
```

`make build` is the source-checkout path; it is not required to operate either
published image.

Published releases produce two independent multi-architecture container images:

```bash
docker pull ghcr.io/cheark0x79/archero-guild-web:<version>
docker pull ghcr.io/cheark0x79/archero-guild-ocr:<version>
```

Both images are built for `linux/amd64` and `linux/arm64`. The Web/API image
contains no Tesseract or raw-capture mount. The OCR image runs only on the
trusted workstation and has no direct PostgreSQL access. The historical
`ghcr.io/cheark0x79/archero-guild:0.2.0` image remains the Web/API artifact for
that release. Deployment-specific Compose overrides, ingress, DNS, and
credentials belong in a separate private operations repository.

## Configuration and persistent state

- `web/.env.prod`, `ocr/.env`, `ocr/targets.json`, and
  `web/.env.development.local` contain environment-specific values and are ignored by Git.
- PostgreSQL lives in the `archero-guild_postgres-data` Docker volume.
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

English is canonical for repository documentation and API contracts.

## Project policies

- [MIT License](LICENSE)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
