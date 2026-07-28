# Homelab deployment plan

This document describes a reproducible VM deployment target for Archero
Observer in a Proxmox homelab. It covers provisioning, host configuration,
Cloudflare publication, backups, monitoring, security, updates, and rollback.

For the current Docker Compose procedure, use
[`production-homelab.md`](production-homelab.md). This document is the broader
operations plan and contains decisions that still require infrastructure-owner
approval.

## Objectives

- Isolate the application in a dedicated VM instead of running it on the
  Proxmox host.
- Make VM provisioning and server configuration reproducible.
- Publish the dashboard without opening inbound router ports.
- Protect PostgreSQL, configuration, raw screenshots, normalized images, and
  import reports.
- Support atomic application releases and a documented rollback path.
- Keep all secrets outside Git.
- Test backups by restoring them, not only by creating archives.

## Target architecture

```text
Internet
  |
  v
Cloudflare DNS / WAF / Access / Tunnel
  |
  v
cloudflared in the application VM
  |
  +--> 127.0.0.1:5181  Next.js dashboard and /api/v1

Proxmox
  |
  v
VM archero-observer
  |
  +--> application runtime
  |     +--> Python observer: ADB, capture, OCR, import
  |     +--> Next.js dashboard and API
  |
  +--> local PostgreSQL 16
  |
  +--> application filesystem
        +--> /var/lib/archero-observer/screenshots/raw
        +--> /var/lib/archero-observer/screenshots/normalized
        +--> /var/lib/archero-observer/data/imports
        +--> /etc/archero-observer/config.json
        +--> /etc/archero-observer/secrets.env
```

The recommended first target is one VM with local PostgreSQL. This is easier to
audit, back up, and restore. PostgreSQL and image storage can be externalized
later if usage requires it.

## Initial decisions

| Topic | Proposed decision | Reason |
| --- | --- | --- |
| Virtualization | Dedicated `archero-observer` Proxmox VM | Isolation, snapshots, and controlled resources |
| Operating system | Debian stable or NixOS | Debian for conventional operations; NixOS for a fully declarative host |
| Database | PostgreSQL 16 in the VM | Existing schema and tooling, reliable logical backups |
| Images | Local files under `/var/lib/archero-observer` | Matches current capture and OCR paths |
| Public exposure | Cloudflare Tunnel and Access | No public inbound port |
| External identity | Cloudflare Access | Central identity and MFA before application authentication |
| Runtime | Docker Compose initially; systemd or Nix units if selected | Compose is implemented today; host-native units remain an option |
| Build | Versioned production Docker image | Same artifact for staging and production |

Before implementation, confirm the final OS, domain, backup destination,
long-term storage, and configuration-management tool.

## Automation layers

### Infrastructure provisioning

Terraform should manage infrastructure only:

- `archero-observer` VM;
- CPU, RAM, system disk, and optional data disk;
- network, VLAN, and static IP or DHCP reservation;
- cloud-init;
- SSH administrator;
- Proxmox tags and description;
- optional dedicated storage mounted at `/var/lib/archero-observer`.

Suggested layout:

```text
infra/
  terraform/
    proxmox/
      main.tf
      variables.tf
      outputs.tf
      versions.tf
      terraform.tfvars.example
  config/
    ansible/
      inventory.example.yml
      playbook.yml
      roles/
        archero_observer/
        postgresql/
        cloudflared/
        backups/
        monitoring/
```

Do not commit Terraform state. Acceptable homelab backends include:

- an encrypted and backed-up local backend;
- a versioned S3-compatible MinIO backend;
- Terraform Cloud when SaaS storage is acceptable.

### Server configuration

The selected configuration-management layer should install and maintain:

- Docker Engine and Compose, or the chosen Node/Nix runtime;
- PostgreSQL 16 when it is not containerized;
- Tesseract and Android platform tools;
- `cloudflared` when it is not containerized;
- backup and monitoring tools;
- a non-root `archero-bot` service account;
- `/opt/archero-observer` for release artifacts;
- `/var/lib/archero-observer` for persistent data;
- `/etc/archero-observer` for configuration and secrets.

Secrets must be delivered outside Git through a protected file, SOPS/Age,
Vaultwarden, 1Password CLI, or an equivalent secret manager.

## Runtime

### Observer worker

The Python worker command is:

```text
python -m observer.run --config /etc/archero-observer/config.json
```

Run it as a non-root user without an interactive shell. Grant access only to
the required data directories and the selected ADB device.

### Dashboard and public API

The Next.js service listens on:

```text
127.0.0.1:5181
```

External traffic must pass through Cloudflare Tunnel. Do not expose this port
to the LAN or WAN unless a documented requirement explicitly calls for it.

### PostgreSQL

PostgreSQL must not be exposed publicly. A host-native installation should
listen only on:

```text
127.0.0.1:5432
```

The application account should have access only to the `archero_observer`
database. Never reuse the development password from `docker-compose.yml`.

## Data storage

Target layout:

```text
/var/lib/archero-observer/
  screenshots/
    raw/YYYY-MM-DD/...
    normalized/YYYY-MM-DD/...
    failed/YYYY-MM-DD/...
  data/
    imports/YYYY-MM-DD.json
  backups/
    staging/
```

Rules:

- treat raw captures as immutable after creation;
- normalized images are reproducible but useful for OCR audits;
- retain import JSON as audit artifacts;
- store structured application data in PostgreSQL;
- prefer paths relative to `/var/lib/archero-observer` for portable restores.

Possible future object-storage targets include MinIO, Backblaze B2, Cloudflare
R2, or Hetzner Object Storage. The VM can keep a recent working cache while
long-term copies live in object storage.

## Backups and restoration

### Required backup set

- daily PostgreSQL logical dump;
- physical PostgreSQL backup if the dataset becomes large;
- `/etc/archero-observer/config.json`;
- secret material in a separate protected vault;
- raw and normalized screenshots;
- import JSON reports;
- the deployed application version and configuration.

### Proposed policy

```text
Every night:
  create a custom-format pg_dump
  archive critical application files
  upload to the backup destination
  verify presence, size, and command exit status

Retention:
  7 daily backups
  4 weekly backups
  12 monthly backups
```

Candidate tools:

- `restic` to S3, B2, R2, or MinIO;
- `borgbackup` to a NAS or SSH server;
- Proxmox Backup Server for VM snapshots, as a complement rather than the only
  application backup.

Restore regularly into a temporary VM or isolated directory. A backup that has
never been restored is not proven.

## Security

### Public access

```text
User -> Cloudflare Access -> Cloudflare Tunnel -> local application
```

Cloudflare Access should enforce:

- authentication through an approved identity provider;
- an explicit user or group allowlist;
- MFA when supported;
- access logs;
- separate administrative and read-only policies when necessary.

The application keeps its own user and administrator roles as a second layer.
Administrative routes remain under `/admin/*` and `/api/data/*`.

### VM hardening

- SSH keys only.
- Disable root SSH login.
- Allow SSH only from the management network.
- Do not open public HTTP ports.
- Bind local services to loopback interfaces.
- Apply security updates automatically or on a documented monthly cadence.
- Store secrets with mode `0600`.
- Do not grant `archero-bot` sudo access.
- Keep persistent system logs with bounded retention.
- Keep `no-new-privileges`, dropped capabilities, and container resource limits.

### Secrets

Expected secrets include:

- PostgreSQL application password;
- dashboard account passwords and session tokens;
- public API keys;
- Cloudflare Tunnel token;
- backup credentials;
- optional monitoring notification tokens.

Inject them through `/etc/archero-observer/secrets.env` or an encrypted secret
workflow. Do not include them in application archives.

## Monitoring and alerting

Minimum checks:

- application, PostgreSQL, and tunnel health;
- observer timer success or failure;
- age of the latest capture and import;
- recent OCR failure count;
- free space under `/var/lib/archero-observer`;
- backup size, duration, and latest successful timestamp;
- HTTP availability through the tunnel;
- VM CPU and memory;
- PostgreSQL connectivity.

Possible lightweight stack:

- Prometheus node exporter and Grafana;
- Uptime Kuma for dashboard and tunnel checks;
- journald for local logs;
- Discord, email, or ntfy notifications.

Use `/api/health` for application liveness and `/api/v1/health` for the public
API process check. Data freshness must be monitored separately through API
metadata.

## Deployment workflow

### First installation

1. Create the VM with Terraform.
2. Apply server configuration.
3. Create persistent directories and secrets.
4. Install or start PostgreSQL and apply `observer/storage/schema.sql`.
5. Build or pull the versioned application image.
6. Start the application and tunnel.
7. Configure Cloudflare Tunnel and Access.
8. Run a dry-run observer cycle.
9. Run public API and authentication smoke tests.
10. Create an initial backup and perform a minimal restore.

### Application update

Recommended pipeline:

```text
CI:
  Python tests
  web tests
  PostgreSQL contract tests
  OpenAPI synchronization check
  dependency audit
  production image build
  immutable image tag

server:
  create backup
  pull the new image
  apply a reviewed migration when required
  replace the application container
  wait for health checks
  run API smoke tests
```

Releases should be immutable and identifiable by Git SHA or a version tag.

### Rollback

1. Stop or replace only the application service.
2. Select the previous immutable image.
3. Restore PostgreSQL only when a migration made rollback impossible.
4. Restart the application.
5. Verify dashboard, API, observer schedule, and logs.

Before any destructive migration, create a PostgreSQL dump and document the
exact application and schema rollback commands.

## Environments

| Environment | Purpose | Data |
| --- | --- | --- |
| Local development | Feature work and fast tests | Demonstration data or isolated development DB |
| Isolated integration | Automated PostgreSQL contract | Dedicated synthetic test data |
| Staging VM or namespace | Pre-production deployment test | Anonymized dump or small reviewed dataset |
| Production VM | Live service | Real reviewed data |

Never test migrations directly against production without a recent backup. If
only one VM exists, use separate ports, database names, volumes, and directories
for logical staging.

## Implementation phases

### Phase 1: decisions

- Select Debian or NixOS.
- Select Ansible, an internal tool, or a NixOS module.
- Choose the Cloudflare domain.
- Choose NAS, PBS, S3-compatible storage, or a combination for backups.
- Define initial VM resources, for example 2 vCPU, 4 GiB RAM, a 40 GiB system
  disk, and an expandable data disk.

### Phase 2: infrastructure as code

- Add `infra/terraform/proxmox`.
- Create a cloud-init VM.
- Export IP, hostname, and useful identifiers.
- Document Proxmox token creation without committing the token.

### Phase 3: server configuration

- Add configuration roles or modules.
- Install runtime, PostgreSQL, Tesseract, and Android tools.
- Create users, directories, permissions, and services.
- Configure the local firewall.

### Phase 4: data and backups

- Add `backup` and `restore-check` commands.
- Automate `pg_dump` and application-file archives.
- Monitor the latest successful backup.
- Restore into a temporary target.

### Phase 5: secure exposure

- Configure Cloudflare Tunnel.
- Add Cloudflare Access.
- Define the user allowlist and MFA policy.
- Verify that no public VM web port is open.

### Phase 6: versioned releases

- Define immutable version naming.
- Add deployment and rollback commands.
- Add post-deployment health and API checks.
- Connect the workflow to CI when the registry is selected.

### Phase 7: monitoring

- Check application, PostgreSQL, and tunnel health.
- Check latest capture and import age.
- Alert on disk and backup failures.
- Add Grafana and Uptime Kuma views when they fit the existing homelab.

## Open questions

- Does “Montcible” refer to Ansible, an internal tool, or another configuration
  manager?
- Does the Proxmox environment already provide Proxmox Backup Server or a NAS?
- Are external users read-only, or may they trigger application actions?
- Will ADB use a physical device attached to the VM, an emulator, or a separate
  capture workstation?
- Should raw captures be retained indefinitely?
- Which monitoring tools already exist in the homelab?
- Which container registry should store immutable production images?
