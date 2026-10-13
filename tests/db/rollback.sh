#!/usr/bin/env bash
# Verifies: up (0001-0005) → down (0005, 0004) → up again, on a scratch DB.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; DB=peb_rollback
p() { psql -v ON_ERROR_STOP=1 -q -U postgres -d "$DB" "$@"; }
"$HERE/reset.sh" "$DB" >/dev/null
p -c "insert into entries (entry_code, registration_id) values ('ENTRY-001','R1'); insert into team_members (entry_id, member_position, full_name) select id, 1, 'A' from entries;"
p -f "$ROOT/supabase/rollback/0005_down.sql"
p -f "$ROOT/supabase/rollback/0004_down.sql"
p -Atc "select 'after down: entries=' || count(*) || ', has entry_number=' || exists(select 1 from information_schema.columns where table_name='entries' and column_name='entry_number') from entries"
p -f "$ROOT/supabase/migrations/0004_event_readiness.sql" 2>&1 | grep -v NOTICE || true
p -f "$ROOT/supabase/migrations/0005_pins_pool_reset.sql" 2>&1 | grep -v NOTICE || true
p -Atc "select 'after re-up: entry_number=' || entry_number || ', functions=' || (select count(*) from pg_proc where proname in ('competition_reset','student_login_precheck','round1_control')) from entries"
