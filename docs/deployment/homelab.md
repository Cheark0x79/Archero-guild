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
cp platform/.env.example platform/.env.production
chmod 600 platform/.env.production
mkdir -p data screenshots/raw screenshots/trash backups
```

Generate eight independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Put them in `POSTGRES_PASSWORD`, `ARCHERO_USER_PASSWORD`,
`ARCHERO_USER_SESSION_TOKEN`, `ARCHERO_ADMIN_PASSWORD`,
`ARCHERO_ADMIN_SESSION_TOKEN`, `ARCHERO_API_KEYS`,
`ARCHERO_SHARE_LINK_SECRET`, and `ARCHERO_INGESTION_KEYS`. Keep different
values for both dashboard accounts, both session tokens, the database, the
public API, temporary member sharing, and OCR ingestion. Usernames default to
`viewer` and `admin` and can be
changed with `ARCHERO_USER_USERNAME` and `ARCHERO_ADMIN_USERNAME`.
Do not reuse a password or commit `platform/.env.production`.

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

Create path-scoped Cloudflare Access applications for authenticated dashboard
and administration routes before sharing the hostname. A suitable initial
policy for those protected paths is:

- Action: `Allow`
- Include: only your email address, identity-provider group, or household
  email domain
- Session duration: 8 to 24 hours
- Require: MFA when supported by the identity provider

Do not place an interactive Cloudflare Access login in front of `/s/*` or
`/shared/*`. These paths implement temporary bearer access for Discord
recipients who intentionally do not have dashboard accounts. The application
validates the signed grant, expiration, and member scope itself. Static boss
images under `/bosses/*` must remain reachable by those shared profiles.

The application still requires its own account on normal dashboard pages and
enforces the administrator role on `/admin/*` and `/api/data/*`. Protect the
machine-to-machine `/api/v1/imports*` paths with a Cloudflare Service Auth
policy when Cloudflare Access is enabled. Other `/api/v1` consumers either use
their application API key directly or a dedicated service token according to
the chosen Cloudflare policy.

## 4. Start and verify

```bash
docker compose --env-file platform/.env.production -f platform/compose.yml config
docker compose --env-file platform/.env.production -f platform/compose.yml build
docker compose --env-file platform/.env.production -f platform/compose.yml up -d
docker compose --env-file platform/.env.production -f platform/compose.yml ps
docker compose --env-file platform/.env.production -f platform/compose.yml logs --tail=100 app cloudflared
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
and test `/login`, `/dashboard`, `/members`, `/activity`, and `/admin`.

## Persistence

The following data survives container replacement:

- PostgreSQL: named volume `postgres-data`
- Rules, officer follow-up, private member administration, imports, and exports:
  host directory `./data`

The PostgreSQL schema in `observer/storage/schema.sql` is initialized only when
the database volume is first created. In database mode, guild rules are stored
in PostgreSQL `rule_settings`; a valid legacy `data/rules.json` is migrated when
that table is empty. Raw screenshots stay on the trusted OCR workstation and
are not mounted into the public platform.

### Initial data and later updates

An application release never imports or replaces guild data. For the first
deployment, either restore one approved PostgreSQL dump or leave the database
empty and publish the first validated capture from the OCR workstation.

After that initial choice, all guild captures are updated through the versioned
ingestion API. Do not modify `web/sample-data.js`, commit captured data, or
create an application release just to refresh the dashboard.

## Backups

Create and verify a database and file-data backup:

```bash
make backup
```

The command checks the PostgreSQL catalog, the file archive, and SHA-256
checksums. Copy `backups/pre-release` to another machine or storage system.
A backup that exists only on the homelab server is not sufficient. Periodically
restore one dump into a disposable `*_test` database.

## Updates and rollback

For the one-time replacement of the legacy monolithic checkout by the
platform-only deployment, follow
[`migration-platform-split.md`](migration-platform-split.md). It includes the
pre-migration database dump, removal of the old server-side OCR runtime,
Compose volume identity check, fresh-VM restore, and rollback procedure.

Before an update, record the current Git commit:

```bash
git rev-parse HEAD
git pull --ff-only
docker compose --env-file platform/.env.production -f platform/compose.yml build
docker compose --env-file platform/.env.production -f platform/compose.yml up -d
```

For rollback, check out the recorded commit and rebuild. Do not remove the
PostgreSQL volume during routine deployments.

### One-command application releases

The tracked base version is stored in `VERSION`. On the server, `make release`
creates a verified backup, increments a local patch version, builds a versioned
image, replaces only the application container, and waits for the healthcheck:

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

Dashboard pages and internal APIs require a valid application session. The
standard account can access Dashboard, Members, Boss, Records, Activity, and
their internal read APIs. The administrator can additionally access
`/admin/*` and `/api/data/*`. `/login`, authentication endpoints, and
`/api/health` are reachable without a dashboard session.

Local OCR pages and capture mutation routes return `404` in the platform
image.

The versioned integration API under `/api/v1` uses `ARCHERO_API_KEYS` instead
of dashboard cookies. Only `/api/v1/health` needs no API key. Configure clients
according to [`../api.md`](../api.md).

Temporary `/s/*` and `/shared/*` member routes also bypass dashboard login, but
they reveal profile data only when a valid, unexpired share grant is present.

After adding the new user variables to an existing `platform/.env.production`, run
`make release`. Existing sessions are invalidated because the cookie name
changed; sign in again with either account.

Existing deployments must also add `ARCHERO_PUBLIC_ORIGIN` to
`platform/.env.production` before running `make release`.

## Updating production data without OCR on the VM

Keep capture and OCR outside the public VM. The intended split is:

1. The trusted workstation captures screenshots and performs OCR.
2. It validates the resulting structured rows locally.
3. A dedicated synchronization command sends only validated JSON to an
   authenticated administrator API.
4. The production application validates the schema and writes one atomic
   import to PostgreSQL.

The station OCR now uses the versioned import contract and the following
ingestion-key-protected endpoints:

- `GET /api/v1/imports/roster`;
- `POST /api/v1/imports/validate` for the write-free quality gate;
- `POST /api/v1/imports` for transactional and idempotent publication.

The workstation flow is documented in
[`ocr-workstation.md`](ocr-workstation.md). Never expose PostgreSQL or copy partial OCR
files into production.

### Cloudflare request limits

The application locks an address for 15 minutes after five failed password
attempts and limits login JSON bodies to 4 KiB. Keep a second independent
limit at Cloudflare:

- Hostname equals the Archero hostname
- URI path equals `/api/auth/login`
- Request method equals `POST`
- Count by source IP
- Block after 5 requests in 5 minutes for at least 15 minutes

Create this under **Security > WAF > Rate limiting rules**. Apply a separate
rate limit to `/api/v1/imports*`. Screenshot upload limits are enforced by the
loopback-only local OCR application, not by the public platform.

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
