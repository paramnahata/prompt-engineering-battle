#!/usr/bin/env bash
# Runs the HTTP suite against the local staging stack (tests/stack/start.sh), after putting the
# synthetic staging DB back into a known state: no live sessions, no rate-limit counters, staging PINs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; RUN="${STACK_DIR:-/tmp/peb-stack}"
set -a; . "$RUN/app.env"; set +a
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}"
psql -U postgres -d peb_stage -Atqc "update auth_sessions set ended_at = now(), end_reason = 'test_reset' where ended_at is null; delete from rate_limits;"
# Known competition state: both rounds stopped and reset, every synthetic team checked in.
ADMIN=$(psql -U postgres -d peb_stage -Atqc "select id from admins where email = 'admin@staging.local'")
psql -U postgres -d peb_stage -Atqc "select round1_control('stop', '$ADMIN', null); select round2_control('stop', '$ADMIN', null); select competition_reset('$ADMIN', 'RESET COMPETITION'); update entries set present = true where registration_id like 'STG-REG-%';" > /dev/null
cd "$ROOT" && npx tsx tests/stack/restore-pins.ts peb_stage 220 && npm run test:api
