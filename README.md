# Archero Observer

Archero Observer is a visual data collection pipeline and dashboard for an
Archero guild. It captures game screens through ADB, extracts rankings and
member metrics with OCR, normalizes the results, stores reviewed data in
PostgreSQL, and exposes a read-only API for integrations such as Discord bots.

The project intentionally uses conventional visual automation through ADB,
Appium, and OCR. It does not intercept network traffic, modify the game, or
attempt to bypass detection.

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/README.md`](docs/README.md) | Documentation index |
| [`docs/api.md`](docs/api.md) | Public API usage, authentication, and endpoints |
| [`docs/api-fields.md`](docs/api-fields.md) | Field dictionary, nullability, and provenance |
| [`docs/openapi.yaml`](docs/openapi.yaml) | Canonical OpenAPI 3.1 contract |
| [`docs/member-evaluation-flags.md`](docs/member-evaluation-flags.md) | Evaluation flags and severities |
| [`docs/test-environment.md`](docs/test-environment.md) | Isolated PostgreSQL integration environment |
| [`docs/production-homelab.md`](docs/production-homelab.md) | Current Docker and Cloudflare deployment |
| [`docs/deployment-plan.md`](docs/deployment-plan.md) | Longer-term VM deployment plan |
| [`docs/roadmap-k3s-argocd.md`](docs/roadmap-k3s-argocd.md) | Deferred K3s and Argo CD roadmap |

## Repository layout

```text
observer/
  automation/      Worker, ADB integration, and state machine
  ocr/             OCR preprocessing and validation
  pipeline/        Detection, deduplication, and normalization
  storage/         PostgreSQL schema, persistence, exports, and migrations
platform/          Production web/API/PostgreSQL/Cloudflare deployment
ocr/               Local Tesseract workstation product and review UI
contracts/         Versioned JSON exchange contract
web/               Next.js dashboard and HTTP API sources
config/            Example observer configuration
systemd/           Legacy local worker units, not used by the web platform
scripts/           Development and test environment commands
tests/             Python unit and PostgreSQL integration tests
docs/              API, operations, deployment, and review documentation
```

## Product separation

The production server runs only `platform/`: Next.js, the HTTP API,
PostgreSQL, and Cloudflare Tunnel. It contains no ADB bridge, Tesseract package,
raw screenshot mount, or local OCR page.

The trusted workstation runs `ocr/`: BlueStacks/ADB capture, Tesseract,
correction, and publication of reviewed JSON through the authenticated
ingestion API. The two products have independent Compose lifecycles and share
only the versioned contract under `contracts/`.

## Quick start

The core Python unit tests have no external service dependency:

```bash
python3 -m unittest discover -s tests
```

Web tests:

```bash
npm --prefix web ci
npm --prefix web test
```

Start the dashboard:

```bash
npm --prefix web run dev
```

The local dashboard is available at:

```text
http://127.0.0.1:5181
```

Interactive API documentation is available at:

```text
http://127.0.0.1:5181/api-docs
```

## Nix development environment

`flake.nix` provides an isolated development and runtime toolchain:

```bash
nix develop
```

For a directory that is not yet a Git repository:

```bash
nix develop path:.
```

The shell includes:

```text
Python 3.12
pytesseract and Pillow
Tesseract OCR
ADB / android-tools
PostgreSQL client
Node.js 22
```

Useful commands:

```bash
nix flake check
nix build
nix run . -- --config config/observer.example.json
nix run .#dashboard
python -B -m unittest discover -s tests
node --test web/tests/*.test.mjs
archero-capture guild-members
archero-capture guild-boss
archero-day 2026-07-16
archero-import 2026-07-16
archero-dashboard
```

Appium is not included directly because it is not available in the tested
`nixpkgs` snapshot. OpenCV is also excluded from the default shell because that
snapshot does not provide a usable Python `cv2` module. The OCR adapter uses
Pillow and pytesseract for deterministic preprocessing. Add a pinned and tested
OpenCV derivation if advanced image processing becomes necessary.

For a complete non-Nix environment, install the platform-specific equivalents:

```text
Android Emulator and adb
Appium and UiAutomator2 when required
Tesseract OCR
Pillow and pytesseract
PostgreSQL
Node.js 22
```

## Configuration

Copy `config/observer.example.json` to a private location, for example:

```text
/etc/archero-observer/config.json
```

Keep secrets outside the repository:

```text
/etc/archero-observer/secrets.env
```

Restrict access to the secrets file:

```bash
chmod 600 /etc/archero-observer/secrets.env
```

Run the observer:

```bash
python3 -m observer.run --config config/observer.example.json
```

The example configuration uses `dry_run` by default. It validates the
configuration and simulates state transitions without controlling an emulator.

## Capturing and importing screenshots

When the device is already on the correct screen:

```bash
archero-capture guild-members
archero-capture guild-boss
```

These commands only invoke:

```text
adb exec-out screencap -p
```

Screenshots are organized by the Europe/Paris date:

```text
screenshots/raw/YYYY-MM-DD/guild/members-001.png
screenshots/raw/YYYY-MM-DD/guild/members-002.png
screenshots/raw/YYYY-MM-DD/boss/boss-001.png
```

Preview the next output name without calling ADB:

```bash
archero-capture guild-members --dry-run
```

Select one device when several ADB devices are connected:

```bash
archero-capture guild-members --serial DEVICE_SERIAL
```

Process screenshots already stored for one day:

```bash
archero-day 2026-07-17
```

Without a date, `archero-day` uses the current Europe/Paris date. It reads
existing screenshots, runs OCR and import, and updates local demonstration data.
It does not capture new screenshots.

Import one captured day:

```bash
archero-import 2026-07-16
```

The import writes an audit report to `data/imports/YYYY-MM-DD.json`. When a
database URL is configured, it also persists the reviewed roster, snapshots,
screenshots, and boss results to PostgreSQL.

## Screenshot normalization

Keep raw and processed images separate:

```text
screenshots/raw/          original ADB output
screenshots/normalized/   deterministic PNG input for OCR
screenshots/failed/       captures or crops requiring review
```

Normalization can apply:

- a fixed target size;
- an optional region crop;
- RGB or grayscale conversion;
- optional autocontrast;
- optional thresholding for numeric OCR fields;
- a SHA-256 hash of the generated artifact.

The same input and profile should always produce the same output and hash. OCR
alerts and imports should therefore reference normalized images rather than raw
screenshots.

## Database and data modes

The PostgreSQL source of truth is
[`observer/storage/schema.sql`](observer/storage/schema.sql).
`docker-compose.yml` starts only the local development database. Its password is
for development and must never be reused in production.

When `ARCHERO_DATABASE_URL` or `DATABASE_URL` is set:

- imports persist structured data to PostgreSQL;
- dashboard and public API reads come from PostgreSQL;
- an empty or unavailable database is never completed with demonstration data;
- unavailable data is returned with `dataMode: "unavailable"` and empty
  structures.

When no database URL is configured, the application explicitly uses local
demonstration mode and returns `dataMode: "demo"`.

Copy the environment examples:

```bash
cp .env.example .env
cp web/.env.local.example web/.env.local
docker compose up -d postgres
set -a; source .env; set +a
```

The development database listens on `127.0.0.1:55440` by default. Override it
with `ARCHERO_POSTGRES_PORT`. `ARCHERO_DATABASE_URL` takes precedence over
`DATABASE_URL`.

## Isolated database tests

The integration environment is separate from development and production:

```powershell
.\scripts\test-env.ps1 test
.\scripts\test-env.ps1 stop
```

Linux or WSL:

```bash
bash scripts/test-env.sh test
bash scripts/test-env.sh stop
```

See [`docs/test-environment.md`](docs/test-environment.md) for lifecycle,
resource, log, and reset commands.

## Migrating JSON reports to PostgreSQL

Replay all existing import reports:

```bash
nix develop -c python -B -m observer.storage.migrate_json --apply-schema
```

Validate without writing:

```bash
nix develop -c python -B -m observer.storage.migrate_json --dry-run
```

Migrate one date:

```bash
nix develop -c python -B -m observer.storage.migrate_json --date 2026-07-19
```

Include OCR extraction:

```bash
nix develop -c python -B -m observer.storage.migrate_json --with-ocr
```

Migration is idempotent: replaying the same report reuses its existing batch.
The JSON output includes `warnings` when referenced screenshots or OCR
dependencies are unavailable.

## Public API

The read-only API is versioned under `/api/v1`. It exposes guild health,
members, rules, evaluations, histories, and boss rankings. Configure one or
more comma-separated keys:

```env
ARCHERO_API_KEYS=replace-with-a-long-random-secret
```

All routes except `/api/v1/health` require either a Bearer token or
`X-API-Key`. Production fails closed with `503` when no API key is configured.
See [`docs/api.md`](docs/api.md) and
[`docs/api-fields.md`](docs/api-fields.md) for the complete contract.

## Deployment

For the supported Docker Compose deployment behind Cloudflare Tunnel, see
[`docs/production-homelab.md`](docs/production-homelab.md).

The VM operations plan is in [`docs/deployment-plan.md`](docs/deployment-plan.md).
The deferred Proxmox, K3s, and Argo CD architecture is in
[`docs/roadmap-k3s-argocd.md`](docs/roadmap-k3s-argocd.md).
