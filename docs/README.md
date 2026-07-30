# Documentation

This directory contains the public contract, operational guides, test reports,
and longer-term deployment plans for Archero Observer.

## Start here

| Document | Audience | Contents |
| --- | --- | --- |
| [`../README.md`](../README.md) | Contributors | Project overview, local setup, capture, import, and database workflow |
| [`api.md`](api.md) | API consumers | Authentication, endpoints, parameters, errors, and examples |
| [`api-fields.md`](api-fields.md) | API consumers | Field types, nullability, provenance, and compatibility rules |
| [`openapi.yaml`](openapi.yaml) | Tools and client generators | Canonical OpenAPI 3.1 specification |
| [`member-evaluation-flags.md`](member-evaluation-flags.md) | Bot and UI developers | Evaluation flag meanings and severity guidance |

## Testing and quality

| Document | Contents |
| --- | --- |
| [`api-test-report.md`](api-test-report.md) | Current API compatibility and live HTTP validation results |
| [`test-environment.md`](test-environment.md) | Isolated PostgreSQL 16 integration environment |
| [`stability-review.md`](stability-review.md) | Application stability findings, fixes, and remaining limits |

## Deployment and operations

| Document | Status | Contents |
| --- | --- | --- |
| [`production-homelab.md`](production-homelab.md) | Current | Docker Compose deployment behind Cloudflare Tunnel |
| [`deployment-plan.md`](deployment-plan.md) | Planned | Reproducible VM provisioning, backups, monitoring, and rollback |
| [`roadmap-k3s-argocd.md`](roadmap-k3s-argocd.md) | Deferred | Proxmox, K3s, Argo CD, and GitOps target architecture |

## Documentation rules

- English is the canonical language for repository documentation and OpenAPI
  descriptions.
- `docs/openapi.yaml` is the source of truth for the served
  `web/public/openapi.yaml`.
- Run `npm --prefix web run openapi:sync` after editing the canonical contract.
- Existing endpoint paths, parameter names, and response fields are treated as
  backward-compatible public contracts.
- New response fields must be additive. Unknown numeric data must be represented
  as `null`, not as a fabricated zero.
