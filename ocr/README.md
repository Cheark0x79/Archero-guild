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

Edit `ocr/targets.json` with separate pre-production and production ingestion
keys. If Cloudflare Access protects the hostname, also configure its service
token ID and secret. Both real files are ignored by Git.

The selector contains three isolated environments:

- `local`: runs Tesseract, creates the outbox JSON and displays it for review
  without any network request; publication is disabled;
- `app-test`: publishes to the disposable application test environment;
- `preprod`: fetches the remote roster, validates remotely, then publishes only
  after `PUBLISH PREPROD`;
- `prod`: uses separate production credentials and requires `PUBLISH PROD`.

The committed `.example.com` hostnames are placeholders. Replace them in the
ignored `ocr/targets.json`; the UI reports them as unconfigured until then.

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
5. Choose `preprod` or `prod`, type the environment-specific confirmation, and
   publish. The backend validates the corrected JSON before its database
   transaction.

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
