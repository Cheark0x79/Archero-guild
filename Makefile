ENV_FILE ?= web/.env.prod
WEB_IMAGE ?= ghcr.io/cheark0x79/archero-guild-web
VERSION = $(shell cat VERSION)
IMAGE_TAG ?= $(VERSION)
COMPOSE = ARCHERO_WEB_IMAGE=$(WEB_IMAGE) ARCHERO_IMAGE_TAG=$(IMAGE_TAG) docker compose --env-file $(ENV_FILE) -f web/compose.yml
OCR_ENV_FILE ?= ocr/.env
OCR_COMPOSE = docker compose --env-file $(OCR_ENV_FILE) -f ocr/compose.yml
OCR_TEST_IMAGE ?= archero-guild-ocr:test
OCR_IMAGE ?= archero-guild-ocr

.PHONY: build build-web build-ocr start stop update backup status logs test doctor ocr-start ocr-stop ocr-status ocr-logs

build: build-web build-ocr

build-web:
	docker build -f web/Dockerfile --build-arg APP_VERSION=$(VERSION) -t archero-guild-web:$(VERSION) .

build-ocr:
	docker build -f ocr/Dockerfile --build-arg APP_VERSION=$(VERSION) -t $(OCR_IMAGE):$(VERSION) .

start:
	$(COMPOSE) pull app
	$(COMPOSE) up -d --no-build --wait --wait-timeout 90

stop:
	$(COMPOSE) stop

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
	@docker compose --env-file web/.env.dev.example -f web/compose.dev.yml config -q
	@docker compose --env-file web/.env.prod.example -f web/compose.yml config -q
	@docker compose --env-file ocr/.env.example -f ocr/compose.yml config -q
	@echo "Development environment is ready."

ocr-start:
	$(OCR_COMPOSE) up -d --build --wait ui

ocr-stop:
	$(OCR_COMPOSE) down

ocr-status:
	$(OCR_COMPOSE) ps

ocr-logs:
	$(OCR_COMPOSE) logs --tail=100 ui
