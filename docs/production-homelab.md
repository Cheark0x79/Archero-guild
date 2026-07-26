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

Generate five independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Put them in `POSTGRES_PASSWORD`, `ARCHERO_USER_PASSWORD`,
`ARCHERO_USER_SESSION_TOKEN`, `ARCHERO_ADMIN_PASSWORD`,
`ARCHERO_ADMIN_SESSION_TOKEN`, and `ARCHERO_API_KEYS`. Keep different values
for both dashboard accounts and
both session tokens. Usernames default to `viewer` and `admin` and can be
changed with `ARCHERO_USER_USERNAME` and `ARCHERO_ADMIN_USERNAME`.
Do not reuse a password or commit `.env.production`.

Set `ARCHERO_PUBLIC_ORIGIN` to the exact browser-facing origin, without a
trailing path, for example:

```env
ARCHERO_PUBLIC_ORIGIN=https://archero.example.com
```

The application uses this value for server-side redirects so an internal
Docker or proxy hostname can never leak into browser navigation.

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
also requires its own account on every page and enforces the administrator
role on `/admin/*` and `/api/data/*`, providing a second layer for
administrative actions.

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

### One-command application releases

The tracked base version is stored in `VERSION`. On the server, `make release`
increments a local patch version, builds a versioned image, replaces only the
application container, and waits for the healthcheck:

```bash
git pull --ff-only
make release
```

PostgreSQL and Cloudflare Tunnel remain running during this replacement. Use
`make release-minor` or `make release-major` for larger version changes. The
deployed version is stored in the ignored `.release-version` file and appears
in the sidebar and `/api/health`.

Useful operational commands:

```bash
make status
make logs
make pause-tunnel
make resume-tunnel
```

Every application page and API requires a valid account. The standard account
can access Dashboard, Members, Boss, Records, Activity, and their read APIs.
The administrator can additionally access `/admin/*` and `/api/data/*`.
Only `/login`, authentication endpoints, and `/api/health` are reachable
without a valid session.

After adding the new user variables to an existing `.env.production`, run
`make release`. Existing sessions are invalidated because the cookie name
changed; sign in again with either account.

Existing deployments must also add `ARCHERO_PUBLIC_ORIGIN` to
`.env.production` before running `make release`.

## Updating production data without OCR on the VM

Keep capture and OCR outside the public VM. The intended split is:

1. The trusted workstation captures screenshots and performs OCR.
2. It validates the resulting structured rows locally.
3. A dedicated synchronization command sends only validated JSON to an
   authenticated administrator API.
4. The production application validates the schema and writes one atomic
   import to PostgreSQL.

The repository does not yet expose that structured synchronization endpoint.
Until it is implemented, do not expose PostgreSQL or copy partially generated
files into production. Continue importing on the trusted workstation and
deploy only reviewed application data. The next implementation should add a
versioned JSON schema, an idempotency key based on capture date, a dry-run
validation response, and an admin-only `POST /api/data/sync` endpoint.

### Cloudflare request limits

The application locks an address for 15 minutes after five failed password
attempts and limits login JSON bodies to 4 KiB. Keep a second independent
limit at Cloudflare:

- Hostname equals the Archero hostname
- URI path equals `/api/auth/login`
- Request method equals `POST`
- Count by source IP
- Block after 5 requests in 5 minutes for at least 15 minutes

Create this under **Security > WAF > Rate limiting rules**. Also configure a
request-body limit for `/api/data/upload`. The application requires a declared
`Content-Length`, rejects multipart requests above the PNG limit plus 128 KiB
of form overhead, fully decodes PNG input, and rejects images above 12 million
pixels.

The Compose file caps application, PostgreSQL, and tunnel CPU, memory, and
process counts. Revisit these values only after observing real production
usage.

## Network exposure

- PostgreSQL has no published host port.
- The application port is bound to `127.0.0.1`, not the LAN or WAN.
- `cloudflared` establishes an outbound-only tunnel.
- Do not add router port forwarding for this application.

Cloudflare's current tunnel setup is documented at:
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/

Cloudflare Access policies are documented at:
https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
