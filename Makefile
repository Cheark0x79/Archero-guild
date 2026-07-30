ENV_FILE ?= platform/.env.production
COMPOSE = docker compose --env-file $(ENV_FILE) -f platform/compose.yml
OCR_ENV_FILE ?= ocr/.env
OCR_COMPOSE = docker compose --env-file $(OCR_ENV_FILE) -f ocr/compose.yml
VERSION = $(shell if [ -f .release-version ]; then cat .release-version; else cat VERSION; fi)

.PHONY: start deploy backup release release-minor release-major status logs pause-tunnel resume-tunnel ocr-start ocr-stop ocr-status ocr-logs

start:
	ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) up -d --build

deploy:
	ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) build app
	ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) up -d --no-deps app
	@./scripts/wait-for-app.sh "$(ENV_FILE)" "$(VERSION)"
	@echo "Archero $(VERSION) is healthy."

backup:
	@sh ./scripts/backup.sh "$(ENV_FILE)"

release:
	@./scripts/release.sh patch

release-minor:
	@./scripts/release.sh minor

release-major:
	@./scripts/release.sh major

status:
	@ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) ps

logs:
	@ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) logs --tail=100 app postgres cloudflared

pause-tunnel:
	@ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) stop cloudflared

resume-tunnel:
	@ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) start cloudflared

ocr-start:
	$(OCR_COMPOSE) up -d --build --wait ui

ocr-stop:
	$(OCR_COMPOSE) down

ocr-status:
	$(OCR_COMPOSE) ps

ocr-logs:
	$(OCR_COMPOSE) logs --tail=100 ui
