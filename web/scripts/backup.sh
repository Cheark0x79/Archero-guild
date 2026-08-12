#!/bin/sh
set -eu

env_file="${1:-web/.env.prod}"
compose_file="${COMPOSE_FILE:-web/compose.yml}"
backup_root="${BACKUP_DIR:-backups}"

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$backup_root/$timestamp"

if [ -e "$destination" ]; then
  echo "Backup destination already exists: $destination" >&2
  exit 1
fi

mkdir -p "$backup_root"
temporary="$(mktemp -d "$backup_root/.tmp-$timestamp-XXXXXX")"

cleanup() {
  rm -rf "$temporary"
}
trap cleanup EXIT INT TERM

echo "Creating PostgreSQL backup..."
docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$temporary/postgres.dump"

if [ ! -s "$temporary/postgres.dump" ]; then
  echo "PostgreSQL backup is empty." >&2
  exit 1
fi

docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  pg_restore --list \
  < "$temporary/postgres.dump" \
  > "$temporary/postgres.contents"

echo "Creating file-data backup..."
if [ -d data ]; then
  tar -czf "$temporary/data.tar.gz" data
else
  mkdir -p "$temporary/empty-data"
  tar -czf "$temporary/data.tar.gz" -C "$temporary" empty-data
  rm -rf "$temporary/empty-data"
fi
tar -tzf "$temporary/data.tar.gz" >/dev/null

(
  cd "$temporary"
  sha256sum postgres.dump postgres.contents data.tar.gz > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)

mv "$temporary" "$destination"
trap - EXIT INT TERM

echo "Verified backup created at $destination"
