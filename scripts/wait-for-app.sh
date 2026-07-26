#!/bin/sh
set -eu

env_file="${1:-.env.production}"
image_tag="${2:-local}"
attempt=0
while [ "$attempt" -lt 45 ]; do
  if ARCHERO_IMAGE_TAG="$image_tag" docker compose --env-file "$env_file" -f docker-compose.prod.yml exec -T app \
    node -e "fetch('http://127.0.0.1:5181/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
    >/dev/null 2>&1; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "Application healthcheck did not become ready in time." >&2
exit 1
