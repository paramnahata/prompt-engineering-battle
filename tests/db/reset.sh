#!/usr/bin/env bash
# Recreates the local test database from the repository migrations.
# Usage: PGHOST=/tmp PGPORT=54329 tests/db/reset.sh [dbname]
set -euo pipefail
DB="${1:-peb_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
psql -v ON_ERROR_STOP=1 -U postgres -d postgres -qc "drop database if exists $DB with (force)" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -q -f "$HERE/supabase-roles.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -q -f "$f"
done
psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -q -f "$HERE/seed.sql"
echo "reset $DB ok"
