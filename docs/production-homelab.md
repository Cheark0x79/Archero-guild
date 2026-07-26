# Production homelab with Cloudflare Tunnel

This deployment keeps PostgreSQL private, binds the dashboard only to the
server loopback interface, and publishes it through a remotely managed
Cloudflare Tunnel.

## Prerequisites

- A Linux homelab server with Docker Engine and Docker Compose v2.
- A domain managed by Cloudflare.
- Outbound connectivity from the server to Cloudflare. No inbound router port
  forwarding is required.

## 1. Prepare the server

Clone the repository and create the production environment:

```bash
git clone <repository-url> archero-observer
cd archero-observer
cp .env.production.example .env.production
chmod 600 .env.production
mkdir -p data screenshots/raw screenshots/trash backups
```

Generate independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Put the first value in `POSTGRES_PASSWORD`, the second in
`ARCHERO_ADMIN_PASSWORD`, and the third in `ARCHERO_ADMIN_SESSION_TOKEN`.
Do not reuse a password or commit `.env.production`.

## 2. Create the Cloudflare Tunnel

In Cloudflare, open **Networking > Tunnels**, create a remotely managed tunnel,
and copy its token into `CLOUDFLARE_TUNNEL_TOKEN`.

Add a **Published application** route:

- Hostname: for example `archero.example.com`
- Service type: `HTTP`
- Service URL: `http://app:5181`

The `cloudflared` container and the application share the private `tunnel`
Docker network, so the service name `app` is intentional. Do not use
`localhost` here.

## 3. Protect access

Create a Cloudflare Access self-hosted application for the hostname before
sharing it. The safest initial policy is:

- Action: `Allow`
- Include: only your email address, identity-provider group, or household
  email domain
- Session duration: 8 to 24 hours
- Require: MFA when supported by the identity provider

Protecting the whole hostname is recommended for the first deployment. The app
also keeps its own password protection on `/admin` and `/api/data/*`, providing
a second layer for administrative actions.

If the public dashboard must later be anonymous, create more specific Access
applications for `/admin/*` and `/api/data/*` instead of removing the
application's own admin authentication.

## 4. Start and verify

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 app cloudflared
```

Local health check on the homelab server:

```bash
curl --fail http://127.0.0.1:5181/api/health
```

Expected response:

```json
{"ok":true,"service":"archero-observer"}
```

Then open the Cloudflare hostname, verify that Access asks for your identity,
and test `/login`, `/dashboard`, `/admin/check`, and `/admin/data`.

## Persistence

The following data survives container replacement:

- PostgreSQL: named volume `postgres-data`
- Reviews, rules, imports, and exports: host directory `./data`
- Raw and discarded screenshots: host directory `./screenshots`

The PostgreSQL schema in `observer/storage/schema.sql` is initialized only when
the database volume is first created.

## Backups

Create a database backup:

```bash
mkdir -p backups
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U archero -d archero_observer -Fc > "backups/postgres-$(date +%F).dump"
tar -czf "backups/files-$(date +%F).tar.gz" data screenshots
```

Copy the `backups` directory to another machine or storage system. A backup
that exists only on the homelab server is not sufficient.

## Updates and rollback

Before an update, create a backup and record the current Git commit:

```bash
git rev-parse HEAD
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

For rollback, check out the recorded commit and rebuild. Do not remove the
PostgreSQL volume during routine deployments.

## Network exposure

- PostgreSQL has no published host port.
- The application port is bound to `127.0.0.1`, not the LAN or WAN.
- `cloudflared` establishes an outbound-only tunnel.
- Do not add router port forwarding for this application.

Cloudflare's current tunnel setup is documented at:
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/

Cloudflare Access policies are documented at:
https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
