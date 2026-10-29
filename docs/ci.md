# Repository validation

The `CI / verify` job runs on every branch push, pull request and merge-group
candidate, including pushes after a merge to `main`. It validates code only;
production deployment and backups are separate operations. Container publishing
remains limited to published releases.

The local equivalent is:

```sh
make doctor
make test
make build
make smoke
```

`make test` installs the committed npm lockfile with `npm ci` on Node 26,
matching the production image. It builds the OCR image, runs Python tests in
that image, runs Web tests, documentation and privacy checks, audits production
npm dependencies, builds Next.js, and runs real PostgreSQL contracts in an
isolated disposable Compose project. Set `COMPOSE_PROJECT_NAME` and
`OCR_TEST_IMAGE` to unique values for concurrent worktrees.

`make doctor` renders the committed example configurations and checks positive
CPU, memory and PID limits, no-new-privileges, application capability dropping,
loopback publication and private PostgreSQL networking. `make smoke` starts
both built images without network access or host ports, uses only synthetic
OCR configuration in tmpfs, checks HTTP health inside each container, and runs
a generated image through the real Tesseract binary and installed languages.
It removes only its own disposable containers on exit.

## Dependency and image policy

Actions are pinned by commit SHA with readable version comments. Validation
uses read-only repository permissions. Trivy caching is disabled to avoid
sharing scanner caches between untrusted pull requests and protected branches.
Dependency installation caches are not shared; npm installs from the lockfile.

CI prints HIGH/CRITICAL image reports for both final images, and fails on
fixable CRITICAL findings. Unfixed findings are excluded from that gate by
`ignore-unfixed`; HIGH findings require review but do not fail the existing
image policy. npm's production audit remains a blocking check. Scanner errors
fail CI. Review the Actions logs for the reports and exact image tags.
Do not run automatic `npm audit fix`: review specific version and lockfile
changes, then run the checks above and the image scans again.

The controlled updates to Next 16.4.1 and Pillow 13.0.0 address the reported
security advisories. See the [Next security advisories](https://github.com/vercel/next.js/security/advisories)
and [Pillow 13 release notes](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html).

Dependabot updates cover npm, pip, Docker and Actions. Dependency review and
CodeQL are configured with public-repository gates; private repositories need
the corresponding GitHub security entitlement. Their skipped jobs do not mean
that a security analysis passed.

## Required checks are repository settings

Workflow files cannot enforce merge protection. An authorized repository
administrator must require `CI / verify` on the integration branch and, when
available, Dependency review and both CodeQL analyses. Issue #8 records that
the current private-repository plan does not support the needed protections.
Until the plan/visibility permits them and an administrator enables the rules,
required-check enforcement remains incomplete. This change does not alter
repository settings or claim protection is enabled.
