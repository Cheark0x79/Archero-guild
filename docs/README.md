# Documentation

This index routes readers to the current source of truth. English is canonical
for repository, architecture, configuration, operations, and API contracts.
French documents under `guides/fr/` are operator-oriented guides and must link
back to the canonical contract they explain.

## Start here

| Document | Audience | Status | Purpose |
| --- | --- | --- | --- |
| [`../README.md`](../README.md) | New contributors and operators | Current | Product boundaries, prerequisites, quick start, and common commands |
| [`architecture.md`](architecture.md) | Maintainers and operators | Current | Components, data flow, trust boundaries, and ownership |
| [`configuration.md`](configuration.md) | Developers and operators | Current | Environment settings, defaults, secrets, and rotation |
| [`operations.md`](operations.md) | Homelab operator | Current | Status, logs, backup, restore, update, rollback, and incidents |

## API and shared contracts

| Document | Audience | Status | Purpose |
| --- | --- | --- | --- |
| [`api.md`](api.md) | API and bot developers | Canonical | Authentication, routes, short member links, errors, and examples |
| [`api-fields.md`](api-fields.md) | API and bot developers | Current | Field types, nullability, provenance, and compatibility |
| [`openapi.yaml`](openapi.yaml) | Tools and client generators | Canonical | OpenAPI 3.1 machine-readable contract |
| [`member-evaluation-flags.md`](member-evaluation-flags.md) | Bot and UI developers | Current | Evaluation flag meanings and severities |
| [`../contracts/import-batch.schema.json`](../contracts/import-batch.schema.json) | Platform and OCR maintainers | Canonical | Versioned OCR ingestion payload contract |

## Deployment and testing

| Document | Audience | Status | Purpose |
| --- | --- | --- | --- |
| [`deployment/homelab.md`](deployment/homelab.md) | Homelab operator | Current | First Docker Compose and Cloudflare deployment |
| [`deployment/ocr-workstation.md`](deployment/ocr-workstation.md) | OCR operator | Current | Local capture, review, pre-production, and production publication |
| [`deployment/test-environment.md`](deployment/test-environment.md) | Developers | Current | Isolated PostgreSQL integration environment |
| [`deployment/migration-platform-split.md`](deployment/migration-platform-split.md) | Existing installation operator | One-time | Migration from the legacy monolithic deployment |
| [`guides/fr/discord-warnings.md`](guides/fr/discord-warnings.md) | French-speaking bot operator | Current guide | Practical warning API examples; `api.md` remains canonical |

## Roadmaps

| Document | Status | Purpose |
| --- | --- | --- |
| [`roadmap/vm-deployment.md`](roadmap/vm-deployment.md) | Planned | Broader reproducible VM, monitoring, and backup design |
| [`roadmap/k3s-argocd.md`](roadmap/k3s-argocd.md) | Deferred | Proxmox, K3s, Argo CD, and GitOps target architecture |

## Historical reports

These files preserve dated evidence and decisions. They are not current
runbooks.

| Document | Status | Purpose |
| --- | --- | --- |
| [`archive/2026-07/api-test-report.md`](archive/2026-07/api-test-report.md) | Historical | API compatibility audit from July 2026 |
| [`archive/2026-07/stability-review.md`](archive/2026-07/stability-review.md) | Historical | Stability review from July 2026 |
| [`archive/2026-07/reprise-2026-07-29.md`](archive/2026-07/reprise-2026-07-29.md) | Historical | French project handoff note from 29 July 2026 |

## Documentation contract

- `docs/openapi.yaml` is canonical; `web/public/openapi.yaml` is generated.
- Run `npm --prefix web run openapi:sync` after changing OpenAPI.
- Run `npm --prefix web run docs:check` before committing documentation.
- Every Markdown file under `docs/` must appear in this index.
- API v1 changes remain backward compatible: new fields are additive and
  consumers must accept unknown fields and evaluation flags.
- Never put real credentials, production identifiers, or private guild data in
  documentation or examples.
