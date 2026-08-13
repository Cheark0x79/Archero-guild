ENV_FILE ?= web/.env.prod
WEB_IMAGE ?= ghcr.io/cheark0x79/archero-guild-web
VERSION = $(shell cat VERSION)
IMAGE_TAG ?= $(VERSION)
COMPOSE = ARCHERO_WEB_IMAGE=$(WEB_IMAGE) ARCHERO_IMAGE_TAG=$(IMAGE_TAG) docker compose --env-file $(ENV_FILE) -f web/compose.yml
OCR_ENV_FILE ?= ocr/.env
OCR_COMPOSE = docker compose --env-file $(OCR_ENV_FILE) -f ocr/compose.yml
OCR_TEST_IMAGE ?= archero-guild-ocr:test
OCR_IMAGE ?= archero-guild-ocr

.PHONY: help prepare build build-web build-ocr start stop restart update backup status logs test doctor ocr-prepare ocr-start ocr-stop ocr-restart ocr-update ocr-status ocr-logs

help:
	@echo "Archero Guild operations"
	@echo "  make doctor         Validate Docker, examples, release/configuration hygiene"
	@echo "  make prepare        Pull the pinned Web/API image"
	@echo "  make start|stop|restart|status|logs|update|backup"
	@echo "  make build          Build both products from this checkout"
	@echo "  make ocr-prepare    Pull the pinned OCR workstation image"
	@echo "  make ocr-start|ocr-stop|ocr-restart|ocr-status|ocr-logs|ocr-update"
	@echo "  make test           Run all repository checks and isolated integration tests"

prepare:
	$(COMPOSE) pull app

build: build-web build-ocr

build-web:
	docker build -f web/Dockerfile --build-arg APP_VERSION=$(VERSION) -t archero-guild-web:$(VERSION) .

build-ocr:
	docker build -f ocr/Dockerfile --build-arg APP_VERSION=$(VERSION) -t $(OCR_IMAGE):$(VERSION) .

start:
	$(MAKE) prepare
	$(COMPOSE) up -d --no-build --wait --wait-timeout 90

stop:
	$(COMPOSE) down

restart:
	$(MAKE) stop
	$(MAKE) start

update:
	$(COMPOSE) pull app
	$(COMPOSE) up -d --no-deps --no-build --wait --wait-timeout 90 app
	@echo "Archero $(IMAGE_TAG) is healthy."

backup:
	@sh ./web/scripts/backup.sh "$(ENV_FILE)"

status:
	@$(COMPOSE) ps

logs:
	@$(COMPOSE) logs --tail=100 app postgres

test:
	python3 scripts/check-repository-hygiene.py
	python3 scripts/check-configuration-contract.py
	docker build -f ocr/Dockerfile -t $(OCR_TEST_IMAGE) .
	docker run --rm -v "$(CURDIR):/workspace:ro" -w /workspace \
		-e PYTHONPATH=/workspace/ocr/app --entrypoint python $(OCR_TEST_IMAGE) \
		-B -m unittest discover -s ocr/tests
	docker run --rm -v "$(CURDIR):/workspace:ro" -w /workspace \
		-e PYTHONPATH=/workspace/ocr/app --entrypoint python $(OCR_TEST_IMAGE) \
		-B -m unittest discover -s web/server/tests
	docker run --rm -v "$(CURDIR):/source:ro" -w /workspace node:22-bookworm-slim \
		sh -c 'cp -a /source/. /workspace/ && npm --prefix web ci >/dev/null && npm --prefix web test && npm --prefix web run docs:check && npm --prefix web audit --omit=dev && npm --prefix web run build && npm --prefix web run check:public-bundle'
	bash web/scripts/test-env.sh test

doctor:
	@command -v docker >/dev/null
	@docker compose version >/dev/null
	@python3 scripts/check-repository-hygiene.py
	@python3 scripts/check-configuration-contract.py
	@docker compose --env-file web/.env.dev.example -f web/compose.dev.yml config -q
	@docker compose --env-file web/.env.prod.example -f web/compose.yml config -q
	@docker compose --env-file ocr/.env.example -f ocr/compose.yml config -q
	@echo "Configuration and release prerequisites are valid."

ocr-prepare:
	$(OCR_COMPOSE) pull ui

ocr-start:
	$(OCR_COMPOSE) up -d --no-build --wait ui

ocr-stop:
	$(OCR_COMPOSE) down

ocr-restart:
	$(MAKE) ocr-stop
	$(MAKE) ocr-start

ocr-update:
	$(MAKE) ocr-prepare
	$(OCR_COMPOSE) up -d --no-build --wait ui

ocr-status:
	$(OCR_COMPOSE) ps

ocr-logs:
	$(OCR_COMPOSE) logs --tail=100 ui
