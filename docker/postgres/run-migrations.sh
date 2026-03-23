#!/bin/sh
# run-migrations.sh — Applies all pending SQL migrations to the database.
#
# Uses a schema_migrations table to track which migrations have been applied,
# so this script is safe to run on every startup (idempotent).
#
# Environment:
#   DATABASE_URL — postgres connection string (required)
#   MIGRATIONS_DIR — path to migration files (default: /migrations)

set -e

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

echo "==> Waiting for database to accept connections..."
until psql "$DATABASE_URL" -c '\q' 2>/dev/null; do
  sleep 1
done
echo "==> Database is ready."

# Create the migrations tracking table if it does not exist
psql "$DATABASE_URL" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(255) PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

echo "==> Checking for pending migrations in $MIGRATIONS_DIR..."

applied=0
skipped=0

for migration_file in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$migration_file" ] || continue

  version=$(basename "$migration_file" .sql)

  # Check if this version has already been applied
  count=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT COUNT(*) FROM schema_migrations WHERE version = \$\$${version}\$\$")

  if [ "$count" = "0" ]; then
    echo "  Applying: $version"
    psql "$DATABASE_URL" -f "$migration_file" -v ON_ERROR_STOP=1
    psql "$DATABASE_URL" -c \
      "INSERT INTO schema_migrations (version) VALUES (\$\$${version}\$\$) ON CONFLICT DO NOTHING"
    echo "  Applied:  $version"
    applied=$((applied + 1))
  else
    echo "  Skipped (already applied): $version"
    skipped=$((skipped + 1))
  fi
done

echo "==> Migrations complete: $applied applied, $skipped skipped."
