# Archero platform

This product runs on the Proxmox pre-production or production VM:

- Next.js front end and backend API;
- authenticated OCR ingestion endpoints;
- PostgreSQL;
- Cloudflare Tunnel.

It deliberately contains no Tesseract package, ADB bridge, screenshot mount, or
local OCR page. In production, PostgreSQL is mandatory and bundled demonstration
data is never used as a fallback.

## Configuration

```bash
cp platform/.env.example platform/.env.production
chmod 600 platform/.env.production
```

Set independent session, API, ingestion, PostgreSQL, and Cloudflare secrets.
`ARCHERO_BIND_ADDRESS=127.0.0.1` keeps the platform private to a local tunnel.
For direct OCR publication over a trusted LAN, set it to the VM's LAN address
(for example `192.168.1.50`) and restrict port 5181 to the OCR workstation in
the VM firewall.

## Lifecycle

```bash
docker compose --env-file platform/.env.production -f platform/compose.yml config
docker compose --env-file platform/.env.production -f platform/compose.yml up -d --build
docker compose --env-file platform/.env.production -f platform/compose.yml ps
docker compose --env-file platform/.env.production -f platform/compose.yml down
```

`down` preserves the PostgreSQL named volume and the host `data` directory.
Never use `down -v` during a normal deployment.

## Backups and releases

Run a verified backup without deploying:

```bash
make backup
```

`make release`, `make release-minor`, and `make release-major` run the same
backup automatically before building or replacing the application container.
Each backup contains a PostgreSQL custom dump, a `data` archive, a PostgreSQL
catalog listing, and SHA-256 checksums under `backups/pre-release/`.

Copy that directory to storage outside the VM and periodically perform a full
restore on a disposable test database.

For the one-time migration from the former root Compose files, including the
verified database backup and preservation of the existing Docker volume, use
[`docs/deployment/migration-platform-split.md`](../docs/deployment/migration-platform-split.md).
