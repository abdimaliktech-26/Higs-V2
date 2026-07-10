#!/bin/bash
# ============================================================
# Higsi V2 — Database Backup Script
# ============================================================
# Usage: ./scripts/backup.sh [output-dir]
# Default output: ./backups/
#
# Requires:
#   - DATABASE_URL in .env or environment
#   - pg_dump installed
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${1:-$PROJECT_DIR/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DB_URL="${DATABASE_URL:-$(grep DATABASE_URL "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")}"

mkdir -p "$BACKUP_DIR"

echo "=== Higsi V2 Database Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Backup dir: $BACKUP_DIR"
echo ""

# Extract connection details from DATABASE_URL
if [[ "$DB_URL" =~ postgresql://([^:]+):([^@]+)@([^:]+):([^/]+)/(.+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"
  DB_PORT="${BASH_REMATCH[4]}"
  DB_NAME="${BASH_REMATCH[5]%%\?*}"
else
  echo "ERROR: Could not parse DATABASE_URL"
  echo "Expected format: postgresql://user:pass@host:port/dbname"
  exit 1
fi

export PGPASSWORD="$DB_PASS"

# Backup database
echo "Backing up database: $DB_NAME@$DB_HOST:$DB_PORT"
pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --verbose \
  --file="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump" \
  2>&1 | tail -5

echo ""
echo "Backup created: $BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"
echo ""

# Rotate: keep last 30 backups
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +30 -delete

echo "=== Backup complete ==="
