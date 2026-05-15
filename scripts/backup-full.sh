#!/usr/bin/env bash
set -euo pipefail

OUTPUT_ROOT="./backups"
CONTAINER_NAME="gbmaintenance-postgres-dev"
DB_NAME="gbmaintenance"
DB_USER="gbmaint"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-root)
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --container)
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --db-name)
      DB_NAME="$2"
      shift 2
      ;;
    --db-user)
      DB_USER="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$OUTPUT_ROOT/gbmaintenance-backup-$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

echo "[backup] Repository root: $REPO_ROOT"
echo "[backup] Target folder:   $BACKUP_DIR"

if ! docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  echo "[backup] ERROR: container '$CONTAINER_NAME' is not running"
  exit 1
fi

echo "[backup] Dumping database '$DB_NAME' from '$CONTAINER_NAME'..."
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges > "$BACKUP_DIR/db.sql"

tar_if_exists() {
  local path="$1"
  local out="$2"
  if [[ -e "$path" ]]; then
    echo "[backup] Archiving $path -> $out"
    tar -czf "$BACKUP_DIR/$out" "$path"
  else
    echo "[backup] Skipping missing path: $path"
  fi
}

tar_if_exists "uploads" "uploads.tgz"
tar_if_exists "backend/uploads" "backend-uploads.tgz"
tar_if_exists "logs" "logs.tgz"

mkdir -p "$BACKUP_DIR/config"
for file in .env docker-compose.yml docker-compose.dev.yml .env.example; do
  if [[ -f "$file" ]]; then
    cp "$file" "$BACKUP_DIR/config/"
  fi
done

GIT_COMMIT=""
if command -v git >/dev/null 2>&1; then
  GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"
fi

cat > "$BACKUP_DIR/manifest.json" <<JSON
{
  "app": "GB_Maintenance",
  "backup_created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo_root": "$REPO_ROOT",
  "db": {
    "container": "$CONTAINER_NAME",
    "db_name": "$DB_NAME",
    "db_user": "$DB_USER",
    "dump_file": "db.sql"
  },
  "artifacts": [
    "db.sql",
    "uploads.tgz",
    "backend-uploads.tgz",
    "logs.tgz",
    "config/"
  ],
  "git_commit": "$GIT_COMMIT"
}
JSON

echo "[backup] Completed successfully."
echo "[backup] Folder: $BACKUP_DIR"
