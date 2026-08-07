#!/usr/bin/env bash
# Restore from a backup directory created by backup.sh.
set -euo pipefail
BACKUP_DIR=${1:?usage: restore.sh <backup-dir>}

echo "== database =="
if command -v docker >/dev/null && docker ps --format '{{.Names}}' | grep -q postgres; then
  docker compose -f "$(dirname "$0")/../docker/docker-compose.yml" exec -T postgres \
    psql -U quit -d quit_mail -c 'drop schema public cascade; create schema public;'
  docker compose -f "$(dirname "$0")/../docker/docker-compose.yml" exec -T postgres \
    psql -U quit -d quit_mail < "$BACKUP_DIR/quit_mail.sql"
else
  psql "${DATABASE_URL:-postgres://quit:quit@127.0.0.1:5432/quit_mail}" -c 'drop schema public cascade; create schema public;'
  psql "${DATABASE_URL:-postgres://quit:quit@127.0.0.1:5432/quit_mail}" < "$BACKUP_DIR/quit_mail.sql"
fi

echo "== object storage =="
if [ -f "$BACKUP_DIR/store.tar.gz" ] && [ -n "${STORE_FS_PATH:-}" ]; then
  mkdir -p "$STORE_FS_PATH"
  tar -xzf "$BACKUP_DIR/store.tar.gz" -C "$(dirname "$STORE_FS_PATH")"
fi

echo "Restore complete."
