#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose=(docker compose -f "$project_root/web/compose.test.yml")
action="${1:-status}"

case "$action" in
  start)
    "${compose[@]}" up -d --wait postgres
    ;;
  test)
    cleanup() {
      "${compose[@]}" down
    }
    trap cleanup EXIT INT TERM
    "${compose[@]}" up -d --wait postgres
    "${compose[@]}" --profile test run --rm integration-tests
    trap - EXIT INT TERM
    cleanup
    ;;
  status)
    "${compose[@]}" ps
    ;;
  logs)
    "${compose[@]}" logs --tail=100 postgres
    ;;
  stop)
    "${compose[@]}" down
    ;;
  *)
    echo "Usage: bash web/scripts/test-env.sh {start|test|status|logs|stop}"
    exit 2
    ;;
esac
