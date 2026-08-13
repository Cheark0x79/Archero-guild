# Self-hosted GitHub Actions runner

GitHub-hosted runners are the default for this public repository. A
self-hosted runner is optional and must not be used for production deployment,
production secrets, browser profiles, raw screenshots, or OCR target files.

## Required decision before registration

Choose one scope deliberately:

- a repository runner for `Cheark0x79/Archero-guild` (recommended when only
  this project needs it); or
- an organization runner with a restricted runner group and explicit repository
  allow-list (only when several repositories need the same controlled worker).

Register it on a dedicated non-production Linux VM or host account. Give the
account only Docker access needed for disposable CI containers. Do not add it
to production Compose groups, mount the Docker socket into job containers, or
place deployment credentials in runner environment files.

## Minimal hardening checklist

1. Create a dedicated `github-runner` account with no interactive secrets.
2. Use an isolated Docker daemon or disposable VM because pull-request code is
   untrusted code.
3. Restrict repository Actions settings to approved actions and require pinned
   action revisions, as this repository already does.
4. Apply operating-system updates and runner updates promptly; run the service
   with `svc.sh` only after registration.
5. Add only non-production repository secrets, preferably none. GitHub-hosted
   CI already covers the public test/build workflow.
6. Remove the runner from GitHub before deleting its host directory or account.

GitHub generates a short-lived registration token in the selected runner scope.
Obtain it interactively in GitHub immediately before registration; never save
or commit it. Record the chosen scope, host owner, runner labels, and recovery
contact in private operations documentation.
