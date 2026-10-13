#!/usr/bin/env bash
# Runs the HTTP suite against the local staging stack (tests/stack/start.sh), after putting the
# synthetic staging DB back into a known state: no live sessions, no rate-limit counters, staging PINs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; RUN="${STACK_DIR:-/tmp/peb-stack}"
set -a; . "$RUN/app.env"; set +a
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}"
psql -U postgres -d peb_stage -Atqc "update auth_sessions set ended_at = now(), end_reason = 'test_reset' where ended_at is null; delete from rate_limits;"
cd "$ROOT" && npx tsx tests/stack/restore-pins.ts peb_stage 220 && npm run test:api
