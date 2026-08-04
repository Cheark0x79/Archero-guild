# Operations runbook

Run production commands from the repository root on the homelab server. The
canonical environment file is `platform/.env.production`.

## Start and readiness

```bash
docker compose --env-file platform/.env.production -f platform/compose.yml config
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
docker compose --env-file platform/.env.production -f platform/compose.yml \
  logs --tail=100 app postgres cloudflared
```

Logs must not contain passwords, session tokens, API keys, ingestion keys,
temporary share codes, or Cloudflare credentials.

## Graceful stop

```bash
docker compose --env-file platform/.env.production -f platform/compose.yml stop
```

This preserves the PostgreSQL volume and `data/`. To release only public
exposure while keeping the application available on loopback, use
`make pause-tunnel`; restore it with `make resume-tunnel`.

Do not use `down -v`, `docker volume rm`, or
`docker system prune --volumes`: those operations can destroy the database.

## Backup

```bash
make backup
```

The backup script creates a timestamped directory under
`backups/pre-release/` containing:

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
backup_dir="backups/pre-release/<timestamp>"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)

docker compose --env-file platform/.env.production -f platform/compose.yml \
  up -d postgres

docker compose --env-file platform/.env.production -f platform/compose.yml \
  exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$backup_dir/postgres.dump"

tar -xzf "$backup_dir/data.tar.gz"
docker compose --env-file platform/.env.production -f platform/compose.yml \
  up -d --build app cloudflared
curl --fail http://127.0.0.1:5181/api/health
```

After restore, verify the latest import date, a known member, boss history, and
administrator access. Record the date and result of the exercise.

## Update

Record the current state, pull without creating a merge, then use the
backup-first release command:

```bash
git rev-parse HEAD
cat .release-version 2>/dev/null || cat VERSION
git pull --ff-only
make release
make status
curl --fail http://127.0.0.1:5181/api/health
```

`make release` backs up persistent state, builds a versioned image, replaces
only `app`, waits for health, and records the deployed version. PostgreSQL and
Cloudflare Tunnel remain running.

## Rollback

Use the commit recorded before the update:

```bash
git switch --detach <previous-commit>
ARCHERO_IMAGE_TAG=<previous-version> docker compose \
  --env-file platform/.env.production -f platform/compose.yml build app
ARCHERO_IMAGE_TAG=<previous-version> docker compose \
  --env-file platform/.env.production -f platform/compose.yml \
  up -d --no-deps app
curl --fail http://127.0.0.1:5181/api/health
```

Do not restore PostgreSQL merely to roll back application code. Restore a dump
only when a data or schema change requires it and the recovery target is
explicitly approved.

## OCR workstation lifecycle

```powershell
.\ocr\control.ps1 start
.\ocr\control.ps1 status
.\ocr\control.ps1 logs
.\ocr\control.ps1 stop
```

Stopping the OCR container preserves captures, outbox files, and images while
releasing its CPU, memory, and processes.

## Incident checklist

1. Record the deployed commit and version.
2. Run `make status` and collect only bounded logs.
3. Check process health separately from data freshness.
4. Pause the tunnel if public exposure increases risk.
5. Create a verified backup before repair or rollback when state is readable.
6. Never paste secrets or temporary member URLs into incident reports.
