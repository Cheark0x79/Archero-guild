# Local Web development

Start with the [local demo](../README.md#try-the-local-demo). It uses Node.js 22
and synthetic data; Docker Engine with Compose v2 is needed for PostgreSQL and
the full repository checks. Run commands from the repository root.

## Use a local database

In your private `web/.env.development.local`:

1. Remove or comment out `ARCHERO_DATA_MODE=demo`. Explicit demo mode takes
   precedence even when a database URL is configured.
2. Uncomment `ARCHERO_DATABASE_URL` for the local database. Leave `DATABASE_URL`
   unset unless deliberately using that alias.

Start PostgreSQL and restart the development server after changing its settings:

```bash
docker compose --env-file web/.env.development.local \
  -f web/compose.dev.yml up -d postgres
npm --prefix web run dev
```

The database listens on `127.0.0.1:55440` by default. Database mode does not
populate demonstration members or fall back to fixtures when PostgreSQL fails.
The native Web database adapter needs a Python interpreter with `psycopg[binary]`
installed. Set `ARCHERO_PYTHON` to that interpreter if it is not available as
`python`; the [Web image](../web/Dockerfile) supplies this runtime for container
deployments. See the [storage model](../ocr/app/archero_guild/storage/README.md)
and [configuration reference](configuration.md) for details.

## Synthetic Web fixtures

The local Web example enables deterministic synthetic fixtures even when an
isolated launcher injects a PostgreSQL URL. The fixture contains 40 fictional
identities, 21 member days, 21 boss days, and the complete seven-boss rotation.
It never reads or transforms a production export.

Set `ARCHERO_DEMO_SCENARIO` in the local environment to one of:

- `baseline`: complete, internally consistent data;
- `audit-anomalies`: controlled missing and mismatched boss identities;
- `record-variants`: equal scores and personal-record variations;
- `sparse`: missing metrics and unresolved fictional identities.

`ARCHERO_DEMO_SEED` reproduces a variant and `ARCHERO_DEMO_ANCHOR_DATE` moves
the generated 21-day window. Explicit demo mode is accepted only for an HTTP
loopback origin and is refused whenever `ARCHERO_REQUIRE_DATABASE=1`, as it is
in the production Compose stack.

## Verification

See [Contributing](../CONTRIBUTING.md#development-workflow) for the canonical
`make doctor` and `make test` commands, including isolated database tests,
build and documentation checks. Never use production exports as demo fixtures.
