# Architecture

Archero Observer is split into two independently operated products connected by
one versioned JSON contract.

## Product boundaries

| Product | Runtime | Inbound access | Outbound dependencies | Operator |
| --- | --- | --- | --- | --- |
| Web platform | Next.js, Python export adapter, PostgreSQL, Cloudflare Tunnel | HTTPS through Cloudflare; loopback port `5181` on the host | PostgreSQL and Cloudflare | Homelab operator |
| OCR workstation | Python, Tesseract, ADB/BlueStacks, local review UI | Loopback port `5190` only | Platform ingestion API over HTTPS | Trusted workstation operator |

The production image contains no Tesseract, ADB bridge, emulator integration,
or raw screenshot mount. The OCR workstation has no direct PostgreSQL access.

## Data flow

```text
BlueStacks / exported PNG
          |
          v
OCR workstation (:5190)
capture -> OCR -> human review -> import-batch.schema.json validation
          |
          | HTTPS + ingestion key (+ Cloudflare service token when enabled)
          v
Platform ingestion API
          |
          | transactional and idempotent write
          v
PostgreSQL -> dashboard export adapter -> dashboard and /api/v1
                                      -> temporary /s/<code> member links
```

Raw screenshots remain on the workstation. Only reviewed structured JSON is
sent to the server.

## Trust boundaries

- Dashboard sessions protect normal and administrator pages.
- `/api/v1` uses dedicated API keys instead of dashboard cookies.
- Ingestion endpoints use separate ingestion keys and must never share API
  consumer credentials.
- Temporary `/s/<code>` links are bearer grants. Possessing the link grants
  read-only access to one member until expiry; no login is required.
- PostgreSQL is internal to the Compose backend network and has no production
  host port.
- Cloudflare Tunnel is outbound-only. The application still validates every
  session, API key, ingestion key, and temporary share code itself.

## Temporary member sharing

The API returns a compact signed URL such as:

```text
https://archero.example.com/s/<signed-code>
```

The public resolver validates the code, writes an `HttpOnly`, `SameSite=Lax`
cookie scoped to that member profile, and redirects to the clean
`/shared/members/<playerId>` URL. The code and cookie expire together. The
profile is read-only and excludes officer notes, warning actions, raw OCR, and
Discord identity.

Cloudflare Access must not require an interactive login for `/s/*` or
`/shared/*`; otherwise Discord recipients cannot use temporary links.

## Source-of-truth ownership

| Contract or state | Owner |
| --- | --- |
| OCR ingestion schema | `contracts/import-batch.schema.json` |
| PostgreSQL schema | `observer/storage/schema.sql` |
| Public HTTP API | `docs/openapi.yaml` |
| API field semantics | `docs/api-fields.md` |
| Runtime deployment | `platform/compose.yml` and `ocr/compose.yml` |
| Environment semantics | `docs/configuration.md` |
| Operator lifecycle | `docs/operations.md` |

Generated copies and human documentation must be checked against these owners,
not treated as independent contracts.
