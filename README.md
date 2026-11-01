# Archero Guild

Track guild members, activity and boss results in a dashboard, with a read-only
API for integrations such as Discord bots.

- **Web/API** (`web/`): dashboard and reviewed data stored in PostgreSQL.
- **OCR workstation** (`ocr/`): local screenshot extraction, human review and
  publication of validated JSON. Raw screenshots stay on the trusted workstation;
  the Web server does not run Tesseract.

## Try the local demo

Requires Node.js 22. From the repository root:

```bash
npm --prefix web ci
cp web/.env.dev.example web/.env.development.local
npm --prefix web run dev
```

Open <http://127.0.0.1:5181> and sign in with the administrator values in
`web/.env.development.local`. The demo uses fictional data and needs no database.
Keep it on loopback; these example credentials are for local development only.

For PostgreSQL and fixture scenarios, see the [development guide](docs/development.md).

## Find your next step

| I want to… | Read |
| --- | --- |
| Deploy, back up or update the Web/API | [Operations runbook](docs/operations.md) |
| Extract and review screenshots | [OCR workstation guide](ocr/README.md) |
| Configure an environment | [Configuration reference](docs/configuration.md) |
| Build a bot or API integration | [API guide](docs/api.md) · [OpenAPI](docs/openapi.yaml) |
| Understand the data flow and boundaries | [Architecture](docs/architecture.md) |
| Browse all guides and contracts | [Documentation index](docs/README.md) |

Deployment and OCR use Docker Engine with Compose v2. Tesseract is included in
the OCR container. Back up before updates; never delete production database volumes.

## Contribute

With Docker and Compose v2 available, run the repository checks:

```bash
make doctor
make test
```

`make test` runs the Python and Web unit tests, documentation checks, and the
disposable PostgreSQL integration tests. See [CI validation and security policy](docs/ci.md)
for image smoke checks, vulnerability gates and required-check limitations.
See [Contributing](CONTRIBUTING.md) for the workflow and full check coverage.
Repository documentation and API contracts are maintained in English.

[MIT License](LICENSE) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

Archero Guild is an independent community project, not affiliated with, endorsed
by or supported by Habby or the Archero games. Names and marks belong to their
respective owners. No official game assets are distributed; see the
[artwork policy](CONTRIBUTING.md#game-assets-and-trademarks) before contributing media.
