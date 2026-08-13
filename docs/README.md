# Documentation

This index routes readers to the current source of truth. English is canonical
for repository, architecture, configuration, operations, and API contracts.

## Start here

| Document | Audience | Status | Purpose |
| --- | --- | --- | --- |
| [`../README.md`](../README.md) | New contributors and operators | Current | Product boundaries, prerequisites, quick start, and common commands |
| [`architecture.md`](architecture.md) | Maintainers and operators | Current | Components, data flow, trust boundaries, and ownership |
| [`configuration.md`](configuration.md) | Developers and operators | Current | Environment settings, defaults, secrets, and rotation |
| [`operations.md`](operations.md) | Server operator | Current | Status, logs, backup, restore, update, rollback, and incidents |

## API and shared contracts

| Document | Audience | Status | Purpose |
| --- | --- | --- | --- |
| [`api.md`](api.md) | API and bot developers | Canonical | Authentication, routes, short member links, errors, and examples |
| [`api-fields.md`](api-fields.md) | API and bot developers | Current | Field types, nullability, provenance, and compatibility |
| [`openapi.yaml`](openapi.yaml) | Tools and client generators | Canonical | OpenAPI 3.1 machine-readable contract |
| [`member-evaluation-flags.md`](member-evaluation-flags.md) | Bot and UI developers | Current | Evaluation flag meanings and severities |
| [`contracts/import-batch.schema.json`](contracts/import-batch.schema.json) | Web and OCR maintainers | Canonical | Versioned OCR ingestion payload contract |

## OCR and operator guides

| Document | Audience | Status | Purpose |
| --- | --- | --- | --- |
| [`../ocr/README.md`](../ocr/README.md) | OCR operator | Current | Local capture, review, local simulation, and publication |
| [`guides/discord-warnings.md`](guides/discord-warnings.md) | Bot operator | Current guide | Practical warning API examples; `api.md` remains canonical |

## Documentation contract

- `docs/openapi.yaml` is canonical; `web/public/openapi.yaml` is generated.
- Run `npm --prefix web run openapi:sync` after changing OpenAPI.
- Run `npm --prefix web run docs:check` before committing documentation.
- Every Markdown file under `docs/` must appear in this index.
- API v1 changes remain backward compatible: new fields are additive and
  consumers must accept unknown fields and evaluation flags.
- Never put real credentials, production identifiers, or private guild data in
  documentation or examples.
