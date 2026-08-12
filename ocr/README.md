# Archero local OCR workstation

This product runs only on the trusted Windows/WSL workstation:

- screenshot acquisition stays outside this project;
- screenshots are uploaded through `http://127.0.0.1:5190`;
- Tesseract runs in the isolated OCR container;
- raw PNG files and reviewed outbox JSON remain on the workstation;
- only explicitly published JSON is sent to a configured remote backend.

## First configuration

```bash
cp ocr/.env.example ocr/.env
cp ocr/targets.example.json ocr/targets.json
```

The initial file contains only `Local test (offline)`. Start the UI, then use
`Add destination` to save a name, application URL and dedicated ingestion key.
Both real files are ignored by Git.

The selector starts with one protected local environment and accepts any number
of private remote destinations:

- `local`: runs Tesseract, creates the outbox JSON and displays it for review
  without any network request; publication is disabled;
- remote destinations use the identifier generated from their name in the
  confirmation phrase, such as `PUBLISH PROD`;
- each remote destination has its own URL and ingestion key.

Destination secrets and the synchronized roster cache remain in the private
local configuration storage. The API never returns secret values to the UI.
The Destination screen can explicitly refresh the ten most recent imports.
This history contains only dates, status, counts and import identifiers; raw
OCR payloads, screenshots and idempotency keys are never returned.

## Generalization evaluation

Keep evaluation screenshots outside Git so tuning examples and unseen test
captures remain separate. Create a private JSON manifest with `version: 1` and
a `cases` array. Each case supplies `id`, `kind`, `image`, `expectedRows`, and
optionally `roster`, `includePodium`, `identityField`, and `fields`. Run:

```bash
python -m archero_guild.ocr.evaluate /private/eval/manifest.json --output /private/eval/report.json
```

The report records image dimensions, OCR quality, matched/missing/unexpected
rows, row recall, and exact accuracy for every requested field. Never tune the
OCR on the same private captures used for the final evaluation report.

## Guild overview statistics

The Members extraction also reads the fixed guild header: name, ID, level,
members/capacity, total power, expedition points, expedition tier and rank,
and XP progress. These values are attached to the atomic import batch as
`guildStats`, shown above the Members review table, and stored as a dated
PostgreSQL snapshot. Boss screenshots never run this extraction.

 `archero_guild.pipeline.guild_stats.extract_guild_stats_from_screenshot` uses
resolution-independent crops calibrated against private portrait captures.
Raw screenshots remain local and outside Git. Missing header fields mark only
the guild overview as requiring review; they are never guessed from Boss rows.

The extractor can be exercised privately with:

```bash
python -m archero_guild.pipeline.guild_stats /private/guild-overview.png
```

It reports every parsed field plus a `quality` object listing any missing
required values.

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
   When a detected row has no current roster identity, use `Link this row` on
   the missing member instead of adding a duplicate. The existing power,
   activity and contribution values stay on that row while its canonical name
   and Player ID are attached.
5. Choose a configured remote destination, type its environment-specific
   confirmation, and publish. The backend validates the corrected JSON before
   its database transaction.

`Clear extracted data` removes only the outbox JSON and its correction history
for the selected date. Uploaded screenshots are preserved so extraction can be
run again.

Confirmed OCR spellings are kept privately in
`data/outbox/identity-aliases.json`. They help later scans resolve the same OCR
variation to the synchronized canonical member. The synchronized roster always
wins over identities found in older reviewed batches, and no alias or roster
cache is committed to Git.

## Local simulation

Use `Load demo batch` to test reviews, date selection, preflight, final
confirmation, success feedback, idempotent replay and import history without
running Tesseract or contacting any destination. The deterministic identities
are fictional and use `demo-*` player IDs.

Simulation batches and corrections live under `data/outbox/.simulation/`, and
their history stays in the local OCR volume. While a demonstration batch is
active, every network destination is disabled in the selector and the server
rejects attempts to simulate a real OCR batch. A persistent orange banner
identifies the mode.

## LAN destination

When the OCR workstation can reach the application VM directly, set
`ARCHERO_BIND_ADDRESS` to its LAN IP and keep
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
