# Archero local OCR workstation

This product runs only on the trusted Windows/WSL workstation:

- BlueStacks remains native on Windows;
- screenshots are uploaded through `http://127.0.0.1:5190`;
- Tesseract runs in the isolated OCR container;
- raw PNG files and reviewed outbox JSON remain on the workstation;
- only explicitly published JSON is sent to a configured remote backend.

## First configuration

```powershell
Copy-Item ocr/.env.example ocr/.env
Copy-Item ocr/targets.example.json ocr/targets.json
```

The initial file contains only `Local test (offline)`. Start the UI, then use
`Add destination` to save a name, application URL and dedicated ingestion key.
Cloudflare Access credentials remain available under advanced options when a
deployment actually requires them. Both real files are ignored by Git.

The selector starts with one protected local environment and accepts any number
of private remote destinations:

- `local`: runs Tesseract, creates the outbox JSON and displays it for review
  without any network request; publication is disabled;
- remote destinations use the identifier generated from their name in the
  confirmation phrase, such as `PUBLISH PROD`;
- each remote destination has its own URL and ingestion key.

Destination secrets and the synchronized roster cache remain in the private
local configuration storage. The API never returns secret values to the UI.

## Player ID synchronization

The OCR workstation never connects directly to PostgreSQL. Use `Synchronize
IDs` to explicitly read the active roster from a configured application over
its authenticated HTTPS API. The resulting player IDs, names and power hints
are cached locally and can be reused by `Local test` while offline. OCR
extraction never performs a hidden remote request.

## Lifecycle from WSL

```bash
docker compose --env-file ocr/.env -f ocr/compose.yml up -d --build --wait ui
docker compose --env-file ocr/.env -f ocr/compose.yml ps
docker compose --env-file ocr/.env -f ocr/compose.yml logs --tail=100 ui
docker compose --env-file ocr/.env -f ocr/compose.yml down
```

Open `http://127.0.0.1:5190`. Stopping the Compose project releases CPU and RAM
without deleting captures, reviewed JSON, or Docker images.

## Review workflow

1. Choose the capture date and upload a group of `Guild members` or `Guild
   boss` PNG files.
2. Run `Extract with OCR`. Extraction is always local and does not depend on
   the future publication destination.
3. Review the editable Guild and Boss tables. Visible game values such as
   `1.42M`, `1 d 10 h`, and `615.55M` are converted back to their numeric
   contract fields.
4. Every changed cell is written to
   `data/outbox/corrections/YYYY-MM-DD.json` with its before/after values. The
   corrected batch and idempotency key are updated atomically.
5. Choose a configured remote destination, type its environment-specific
   confirmation, and publish. The backend validates the corrected JSON before
   its database transaction.

`Clear extracted data` removes only the outbox JSON and its correction history
for the selected date. Uploaded screenshots are preserved so extraction can be
run again.

## Direct LAN destination

Cloudflare is not required when the OCR workstation can reach the application
VM directly. On the VM, set `ARCHERO_BIND_ADDRESS` to its LAN IP and keep
`ARCHERO_DASHBOARD_PORT=5181`. In OCR Control's Destination step, use:

```text
URL: http://192.168.1.50:5181
Ingestion token: the same value as ARCHERO_INGESTION_KEYS on the VM
```

Allow that port only from the OCR workstation's IP in the VM firewall.
App test, pre-production, and production should keep separate ingestion tokens.

## Safety

- the UI binds only to Windows loopback;
- PNG files are decoded and limited to 15 MB and 12 megapixels;
- scans validate remotely without writing to PostgreSQL;
- publication requires an environment-specific confirmation phrase;
- production never receives raw screenshots or direct access to the workstation.
