# Architecture

Archero Guild is split into two independently operated products connected by
one versioned JSON contract.

## Product boundaries

| Product | Runtime | Inbound access | Outbound dependencies | Operator |
| --- | --- | --- | --- | --- |
| Web/API | Next.js, Python export adapter, PostgreSQL | Configurable host port `5181`, bound to loopback by default | PostgreSQL | Server operator |
| OCR workstation | Python, Tesseract, local review UI | Loopback port `5190` only | Web ingestion API over HTTPS | Trusted workstation operator |

| Image | Includes | Deliberately excluded |
| --- | --- | --- |
| `archero-guild-web` | Next.js dashboard/API, Python PostgreSQL export adapter, public OpenAPI copy, and the application data directory | Tesseract, OCR UI, raw-capture mounts, OCR targets, and a PostgreSQL server |
| `archero-guild-ocr` | Local review UI, OCR pipeline, Tesseract language packs, ingestion-schema copy, and synthetic local fixtures | PostgreSQL client configuration, database credentials, Web dashboard sessions, and raw captures baked into the image |

The Web/API deployment supplies PostgreSQL as a separate internal service and
bind-mounts only its operator-owned `data/` directory. The trusted OCR
workstation supplies its own raw-capture, outbox, roster-cache, and private
target-file mounts. Neither image contains those operational files. The OCR
workstation has no direct PostgreSQL access or device/emulator integration.

## Data flow

```text
Manually exported PNG
          |
          v
OCR workstation (:5190)
explicit roster sync <- HTTPS ingestion API <- PostgreSQL
local cache -> upload -> OCR -> human review -> import-batch.schema.json validation
          |
          | HTTP(S) + ingestion key
          v
Web ingestion API
          |
          | transactional and idempotent write
          v
PostgreSQL -> dashboard export adapter -> dashboard and /api/v1
                                      -> temporary /s/<code> member links
```

Raw screenshots remain on the workstation. Only reviewed structured JSON is
sent to the server. Player IDs can be explicitly synchronized from the roster
API and cached locally; local extraction never opens a hidden database or
network connection.

## Trust boundaries

- Dashboard sessions protect normal and administrator pages.
- `/api/v1` uses dedicated API keys instead of dashboard cookies.
- Ingestion endpoints use separate ingestion keys and must never share API
  consumer credentials.
- Temporary `/s/<code>` links are bearer grants. Possessing the link grants
  read-only access to one member until expiry; no login is required.
- PostgreSQL is internal to the Compose backend network and has no production
  host port.
- Any external reverse proxy is operator-owned. The application validates every
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

## Source-of-truth ownership

| Contract or state | Owner |
| --- | --- |
| OCR ingestion schema | `docs/contracts/import-batch.schema.json` |
| PostgreSQL schema | `ocr/app/archero_guild/storage/schema.sql` |
| Public HTTP API | `docs/openapi.yaml` |
| API field semantics | `docs/api-fields.md` |
| Runtime deployment | `web/compose.yml` and `ocr/compose.yml` |
| Environment semantics | `docs/configuration.md` |
| Operator lifecycle | `docs/operations.md` |

Generated copies and human documentation must be checked against these owners,
not treated as independent contracts.
