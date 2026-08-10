# Contributing

Thank you for helping improve Archero Observer. Keep contributions focused,
reviewable, and free of private guild data.

## Before opening a change

- Search existing issues and pull requests to avoid duplicate work.
- Open an issue before a large architectural or compatibility change.
- Keep personal deployment, DNS, ingress, and secret configuration outside
  this repository.
- Never commit real screenshots, player identities, credentials, database
  exports, backups, or generated OCR data.

## Development workflow

Docker with Compose v2 is the supported development boundary. From the
repository root, run:

```bash
make doctor
make test
```

`make test` runs the OCR and server tests, Web tests, documentation and OpenAPI
checks, the production Web build, the public-bundle privacy check, the npm
production audit, and isolated PostgreSQL integration tests.

Use the example environment files as templates. Keep local files such as
`web/.env.development.local`, `web/.env.prod`, `ocr/.env`, and
`ocr/targets.json` untracked.

## Pull requests

- Explain the problem and the chosen solution.
- Keep unrelated refactors out of the change.
- Add or update tests for behavior changes.
- Update documentation and `docs/openapi.yaml` when a public contract changes.
- Confirm that `make test` passes.
- Call out migrations, compatibility risks, and manual operator steps.

Contributions are accepted under the repository's MIT License.
