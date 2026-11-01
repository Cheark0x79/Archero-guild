# Private screenshot evidence

`/api/admin/evidence` is an administrator-session API for private screenshot evidence. It is separate from ingestion-key APIs, dashboard exports, member profiles and member shares. There is no public URL, public file, original filename, or evidence field added to those outputs. Responses, including errors, use `Cache-Control: private, no-store`; downloads use a non-rendering attachment with `nosniff` and a sandbox policy.

## Access and links

The existing administrator session cookie is required for every operation. An ingestion key alone is insufficient. POST and DELETE also require `x-archero-dashboard-action: 1`. Never place the administrator token in a URL. This repository uses a shared administrator identity: the audit actor is `shared-admin`, not an assertion of an individual person's identity. Restrict access to that account accordingly.

- POST JSON `{ "target": { "kind": "import", "id": "123" }, "image": "<base64 PNG or JPEG>" }` creates an immutable screenshot link and returns its UUID and metadata. Target IDs are decimal strings. An import target must exist in `remote_import_batches`.
- `kind: "correction"` addresses an existing ID in `guild_stat_snapshot_edits`. The adapter checks the table and ID before writing. Missing correction support or a missing record returns 409; it never creates a correction or substitutes a date for its ID.
- GET `?kind=import&targetId=123` lists up to 100 metadata records in creation order, including deletion tombstones. `truncated: true` explicitly signals more records. Follow the returned `nextCursor` as the `cursor` query parameter (URL-encoded) on the same target until it is null. The cursor is the last returned UUID and uses stable creation-time/UUID ordering, including retained tombstones; unknown or other-target cursors are rejected. UUID downloads remain available. No image bytes are included in metadata responses.
- GET `?id=<UUID>` downloads the bytes after a SHA-256 integrity check.
- GET `?id=<UUID>&audit=1` reads up to 100 access and mutation audit events. Follow `nextCursor` as URL-encoded `cursor` on the same evidence/audit query until null. Audit cursors capture an upper event-ID boundary so pagination does not continually chase its own audit-read events; start a fresh query to see subsequent access. Event IDs are returned as decimal strings.
- DELETE JSON `{ "id": "<UUID>", "reason": "Documented privacy request" }` explicitly deletes image bytes while retaining the link, hash, timestamps and audit. A reason of 1–500 characters is mandatory. Repeated deletion is idempotent.

This is an API/storage feature; the daily correction editor does not yet offer evidence selection. Issue #49 must expose the committed correction audit ID before the UI can attach evidence to that specific edit. The adapter's synthetic database tests verify that contract; they do not demonstrate integration with an unmerged editor. No automatic attachment to an import is implied.

## Storage and retention

Bytes live only in PostgreSQL `private_screenshot_evidence`; access and changes live in `private_screenshot_evidence_audit`. Both are separate from public export tables. Transactions commit upload plus audit together, and downloaded bytes are returned only after their audit transaction commits. Download of an unknown UUID is audited as missing. Listing existing metadata, audit reads, deletion and integrity failures are audited. Rejected unauthorized requests never reach storage. These are application audit records, not tamper-proof records against database administrators.

No expiry or background purge is configured. Retain evidence until an administrator explicitly deletes it under a documented reason. This conservative default avoids inventing a retention period. Administrators must review retained sensitive data and choose a deployment-specific policy. Deletion removes bytes from the active row, but database backups/WAL may retain them according to the database backup policy. Restore and backup access must be as private as the administrator API; do not publish database dumps. Restore the evidence and audit tables together. Never restore private screenshots into public assets or JSON exports.

Uploads are capped at 5 MiB decoded and 7 MiB request size, including chunked requests. Only single-frame PNG/JPEG images that pass full Pillow verification and decoding are accepted, capped at 16 million pixels. Each target permits at most 100 active evidence records. This is not malware scanning. Files are always downloaded as opaque attachments. SVG, HTML, caller-provided paths and filenames are not supported. Metadata embedded in an image is retained unchanged: redact sensitive information and strip metadata before uploading. Store only evidence necessary for the correction. Restrict database credentials and backups to operators who may see the same sensitive evidence.

## Missing evidence and recovery

Unknown UUID: 404. Deleted or missing bytes: 410, with a distinct message. Corrupt bytes failing the saved hash: 409, with no download. Storage outage: 503 with no local/public fallback and no internal connection details. A missing target in a metadata listing is reported as `targetStatus: missing`; retained evidence is not silently purged when a target disappears. Correct the reference or recover from a private backup after investigating; do not fabricate replacement evidence.

## Verification

`node --test web/tests/private-evidence.test.mjs` exercises administrator/member access, write protection, download headers and streaming request bounds. `PYTHONPATH=ocr/app python3 -B -m unittest discover -s web/server/tests -p test_private_evidence.py` exercises validation and, when `ARCHERO_INTEGRATION_DATABASE_URL` points to the isolated test database, the transactional upload/list/download/audit/delete lifecycle and both typed target adapters. All images in tests are synthetic. The integration fixture creates and removes only its own randomly named schema.
