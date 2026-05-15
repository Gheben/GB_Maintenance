#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-path> [--container NAME] [--db-name NAME] [--db-user USER]"
  exit 1
fi

BACKUP_PATH="$1"
shift

CONTAINER_NAME="gbmaintenance-postgres-dev"
DB_NAME="gbmaintenance"
DB_USER="gbmaint"

while [[ $# -gt 0 ]]; do
  case "$1" in
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

BACKUP_DIR="$(cd "$BACKUP_PATH" && pwd)"
DB_DUMP="$BACKUP_DIR/db.sql"

if [[ ! -f "$DB_DUMP" ]]; then
  echo "[restore] ERROR: missing dump file: $DB_DUMP"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  echo "[restore] ERROR: container '$CONTAINER_NAME' is not running"
  exit 1
fi

echo "[restore] Repository root: $REPO_ROOT"
echo "[restore] Backup folder:   $BACKUP_DIR"

echo "[restore] Resetting DB schema..."
printf 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME"

echo "[restore] Importing DB dump..."
docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$DB_DUMP"

restore_tgz() {
  local archive="$1"
  local target="$2"

  if [[ ! -f "$BACKUP_DIR/$archive" ]]; then
    echo "[restore] Skipping missing archive: $archive"
    return
  fi

  echo "[restore] Restoring $archive"
  rm -rf "$target"
  mkdir -p "$target"
  tar -xzf "$BACKUP_DIR/$archive" -C "$REPO_ROOT"
}

restore_tgz "uploads.tgz" "uploads"
restore_tgz "backend-uploads.tgz" "backend/uploads"
restore_tgz "logs.tgz" "logs"

echo "[restore] Completed successfully."
echo "[restore] Restart backend/frontend after restore."
