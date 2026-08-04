# Database test environment

This project has an isolated PostgreSQL 16 environment for integration tests.
It is separate from both the development database and production Compose stack.

## Architecture

- Compose project: `archero-guild-db-test`
- PostgreSQL host port: none; the test runner connects through the internal Compose network
- Database: `archero_test`
- Persistent volume: `archero-guild-db-test_postgres-test-data`
- Network: internal to the test project
- Public tunnels and production credentials: not used

The credentials in `docker-compose.test.yml` are test-only and must never be
reused outside this local environment.

For manual host access to PostgreSQL, use the existing development
`docker-compose.yml`, which publishes its separate database on port `55440`.

## Windows with Docker in WSL

```powershell
.\scripts\test-env.ps1 start
.\scripts\test-env.ps1 test
.\scripts\test-env.ps1 status
.\scripts\test-env.ps1 logs
.\scripts\test-env.ps1 stop
```

`stop` releases CPU and memory while preserving the PostgreSQL volume.

To explicitly delete and recreate test data:

```powershell
.\scripts\test-env.ps1 reset -Force
```

## Linux or WSL

```bash
bash scripts/test-env.sh start
bash scripts/test-env.sh test
bash scripts/test-env.sh status
bash scripts/test-env.sh logs
bash scripts/test-env.sh stop
```

Destructive reset:

```bash
bash scripts/test-env.sh reset --force
```

## What the integration test verifies

The test initializes the real PostgreSQL schema, inserts three member snapshots,
a boss result, and guild rules, then verifies:

- only the seeded live member is exported;
- sample member IDs never appear;
- power, contribution, boss-attempt, and 14-day deltas are derived correctly;
- boss damage comes from the stored result;
- rules can be read and updated through PostgreSQL.
