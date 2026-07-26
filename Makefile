ENV_FILE ?= .env.production
COMPOSE = docker compose --env-file $(ENV_FILE) -f docker-compose.prod.yml
VERSION = $(shell if [ -f .release-version ]; then cat .release-version; else cat VERSION; fi)

.PHONY: start deploy release release-minor release-major status logs pause-tunnel resume-tunnel

start:
	ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) up -d --build

deploy:
	ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) build app
	ARCHERO_IMAGE_TAG=$(VERSION) $(COMPOSE) up -d --no-deps app
	@./scripts/wait-for-app.sh "$(ENV_FILE)" "$(VERSION)"
	@echo "Archero $(VERSION) is healthy."

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
