# Contributing

Thank you for helping improve Archero Guild. Keep contributions focused,
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

## Branches, worktrees, and releases

- `main` is the protected integration branch and always represents the next
  releasable version.
- Create focused work from `main` in an isolated worktree under
  `~/workspace/worktrees/archero-guild/<branch-slug>`. Use a purpose-named
  branch such as `feat/ingestion-audit`, `fix/import-validation`, or
  `docs/operator-runbook`; never use an agent or tool name in a branch.
- Open a pull request into `main`, require CI, and merge only after review.
  Do not develop directly in another contributor's worktree.
- Cut a `release/<version>` branch only when release stabilization needs
  changes that should not block ordinary work. Tag the reviewed release commit
  as `v<version>`; the publish workflow validates it against `VERSION`.
- Create a `hotfix/<topic>` branch from the affected release tag when an
  urgent released defect needs a minimal correction. Open a PR to `main`, then
  backport or retag only after the fix is reviewed and tested.
- Keep each concurrent task in its own worktree and Compose project. Stop its
  containers before removing a clean, pushed worktree; never delete volumes as
  part of ordinary worktree cleanup.

## Pull requests

- Explain the problem and the chosen solution.
- Keep unrelated refactors out of the change.
- Add or update tests for behavior changes.
- Update documentation and `docs/openapi.yaml` when a public contract changes.
- Confirm that `make test` passes.
- Call out migrations, compatibility risks, and manual operator steps.

Contributions are accepted under the repository's MIT License.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
