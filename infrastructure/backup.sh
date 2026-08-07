#!/usr/bin/env bash
# Full backup: PostgreSQL dump + object storage tarball.
set -euo pipefail
BACKUP_DIR=${1:-/backups/$(date +%Y%m%d-%H%M%S)}
mkdir -p "$BACKUP_DIR"

echo "== database =="
if command -v docker >/dev/null && docker ps --format '{{.Names}}' | grep -q postgres; then
  docker compose -f "$(dirname "$0")/../docker/docker-compose.yml" exec -T postgres \
    pg_dump -U quit quit_mail > "$BACKUP_DIR/quit_mail.sql"
else
  pg_dump "${DATABASE_URL:-postgres://quit:quit@127.0.0.1:5432/quit_mail}" > "$BACKUP_DIR/quit_mail.sql"
fi

echo "== object storage =="
if [ -n "${STORE_FS_PATH:-}" ] && [ -d "$STORE_FS_PATH" ]; then
  tar -C "$(dirname "$STORE_FS_PATH")" -czf "$BACKUP_DIR/store.tar.gz" "$(basename "$STORE_FS_PATH")"
else
  echo "STORE_FS_PATH not set or missing — for S3/MinIO run: mc mirror local/quit-mail ./store-mirror" >&2
fi

echo "== dkim keys =="
cp -r "$(dirname "$0")/dkim" "$BACKUP_DIR/dkim" 2>/dev/null || true

echo "Backup complete: $BACKUP_DIR"
ls -la "$BACKUP_DIR"
