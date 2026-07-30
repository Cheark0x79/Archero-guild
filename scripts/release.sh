#!/bin/sh
set -eu

release_kind="${1:-patch}"
env_file="${ENV_FILE:-platform/.env.production}"
compose_file="platform/compose.yml"

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file. Copy platform/.env.example and configure it first." >&2
  exit 1
fi

if [ -f .release-version ]; then
  current_version="$(tr -d '[:space:]' < .release-version)"
else
  current_version="$(tr -d '[:space:]' < VERSION)"
fi

case "$current_version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *)
    echo "Invalid version: $current_version" >&2
    exit 1
    ;;
esac

old_ifs="$IFS"
IFS=.
set -- $current_version
IFS="$old_ifs"
major="$1"
minor="$2"
patch="$3"

case "$release_kind" in
  patch) patch=$((patch + 1)) ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  major) major=$((major + 1)); minor=0; patch=0 ;;
  *)
    echo "Release kind must be patch, minor, or major." >&2
    exit 1
    ;;
esac

next_version="$major.$minor.$patch"
export ARCHERO_IMAGE_TAG="$next_version"

echo "Backing up persistent data before release..."
sh ./scripts/backup.sh "$env_file"

echo "Building Archero $next_version..."
docker compose --env-file "$env_file" -f "$compose_file" build app
docker compose --env-file "$env_file" -f "$compose_file" up -d --no-deps app
./scripts/wait-for-app.sh "$env_file" "$next_version"
printf '%s\n' "$next_version" > .release-version
echo "Archero $next_version is deployed and healthy."
