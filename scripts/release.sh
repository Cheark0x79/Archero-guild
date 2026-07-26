#!/bin/sh
set -eu

release_kind="${1:-patch}"
env_file="${ENV_FILE:-.env.production}"

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file. Copy .env.production.example and configure it first." >&2
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
printf '%s\n' "$next_version" > .release-version
export ARCHERO_IMAGE_TAG="$next_version"

echo "Building Archero $next_version..."
docker compose --env-file "$env_file" -f docker-compose.prod.yml build app
docker compose --env-file "$env_file" -f docker-compose.prod.yml up -d --no-deps app
./scripts/wait-for-app.sh "$env_file" "$next_version"
echo "Archero $next_version is deployed and healthy."
