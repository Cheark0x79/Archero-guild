# Operations runbook

Run production commands from the repository root on the application server. The
canonical environment file is `web/.env.prod`.

## First installation and private GHCR access

Copy the release checkout or download its release archive, then create the
private Web configuration. The Makefile is the only operational interface in
this repository.

```bash
cp web/.env.prod.example web/.env.prod
chmod 600 web/.env.prod
make doctor
```

Public packages can be pulled anonymously. While this GitHub repository or
its packages are private, authenticate Docker with a GitHub fine-grained token
that has **Packages: Read** access to this repository (or a classic token with
only `read:packages`). Do not put that token in `web/.env.prod`, `ocr/.env`, a
Compose file, or an image.

```bash
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_LOGIN --password-stdin
unset GHCR_READ_TOKEN
make prepare
make start
```

The Docker credential helper, not the application environment file, stores the
registry credential. Log out with `docker logout ghcr.io` when this host should
no longer pull private packages.

## Start and readiness

```bash
docker compose --env-file web/.env.prod -f web/compose.yml config
make start
make status
curl --fail http://127.0.0.1:5181/api/health
```

`/api/health` proves process liveness. Confirm data readiness separately by
opening the dashboard or calling an authenticated data endpoint and checking
`meta.dataMode`, `meta.partial`, and the latest import timestamp.

## Status and bounded logs

```bash
make status
make logs
docker compose --env-file web/.env.prod -f web/compose.yml \
  logs --tail=100 app postgres
```

Logs must not contain passwords, session tokens, API keys, ingestion keys, or
temporary share codes.

## Graceful stop

```bash
make stop
```

This preserves the PostgreSQL volume and `data/`.

Do not use `down -v`, `docker volume rm`, or
`docker system prune --volumes`: those operations can destroy the database.

## Backup

```bash
make backup
```

The backup script creates a timestamped directory under `backups/` containing:

- `postgres.dump` in PostgreSQL custom format;
- `postgres.contents` proving that `pg_restore` can list the dump;
- `data.tar.gz`;
- `SHA256SUMS` verified before publication.

Copy the completed directory to independent storage. A backup present only on
the server is not sufficient. Define retention on that external storage; a
reasonable initial policy is seven daily, four weekly, and twelve monthly
copies.

## Restore proof

Exercise restoration on a disposable VM or empty test database. Never run the
following `pg_restore --clean` command against normal production during an
update.

```bash
backup_dir="backups/<timestamp>"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)

docker compose --env-file web/.env.prod -f web/compose.yml \
  up -d postgres

docker compose --env-file web/.env.prod -f web/compose.yml \
  exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$backup_dir/postgres.dump"

tar -xzf "$backup_dir/data.tar.gz"
docker compose --env-file web/.env.prod -f web/compose.yml \
  up -d --build app
curl --fail http://127.0.0.1:5181/api/health
```

After restore, verify the latest import date, a known member, boss history, and
administrator access. Record the date and result of the exercise.

## Update

Record the current state, create a backup, then pull the version recorded in
`VERSION` and update the application:

```bash
git rev-parse HEAD
cat VERSION
make backup
make update
make status
curl --fail http://127.0.0.1:5181/api/health
```

`make update` pulls the published image version recorded in `VERSION`, replaces
only `app`, and waits for health. PostgreSQL remains running.

## Rollback

Use the commit recorded before the update:

```bash
IMAGE_TAG=<previous-version> make update
curl --fail http://127.0.0.1:5181/api/health
```

Do not restore PostgreSQL merely to roll back application code. Restore a dump
only when a data or schema change requires it and the recovery target is
explicitly approved.

## OCR workstation lifecycle

```bash
cp ocr/.env.example ocr/.env
cp ocr/targets.example.json ocr/targets.json
make doctor
make ocr-prepare
make ocr-start
make ocr-status
make ocr-logs
make ocr-stop
```

Stopping the OCR container preserves captures, outbox files, and images while
releasing its CPU, memory, and processes.

To update the independently operated OCR product, set
`ARCHERO_OCR_IMAGE_TAG` to the intended release in its private `ocr/.env`,
then run `make ocr-update`. Roll back by restoring the previous tag and running
the same command. The OCR workstation must use an ingestion key dedicated to
its target Web/API environment.

## Incident checklist

1. Record the deployed commit and version.
2. Run `make status` and collect only bounded logs.
3. Check process health separately from data freshness.
4. Disable any external ingress managed by the private operations layer if
   public exposure increases risk.
5. Create a verified backup before repair or rollback when state is readable.
6. Never paste secrets or temporary member URLs into incident reports.
