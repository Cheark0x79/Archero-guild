#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --project-directory "$project_root" -f "$project_root/docker-compose.test.yml")
action="${1:-status}"
option="${2:-}"

case "$action" in
  start)
    "${compose[@]}" up -d --wait postgres-test
    ;;
  test)
    "${compose[@]}" up -d --wait postgres-test
    "${compose[@]}" --profile test run --rm db-contract-tests
    ;;
  status)
    "${compose[@]}" ps
    ;;
  logs)
    "${compose[@]}" logs --tail=100 postgres-test
    ;;
  stop)
    "${compose[@]}" down
    ;;
  reset)
    if [[ "$option" != "--force" ]]; then
      echo "Reset deletes the archero-guild-db-test PostgreSQL volume."
      echo "Run: bash scripts/test-env.sh reset --force"
      exit 2
    fi
    "${compose[@]}" down --volumes
    ;;
  *)
    echo "Usage: bash scripts/test-env.sh {start|test|status|logs|stop|reset [--force]}"
    exit 2
    ;;
esac
