#!/usr/bin/env bash
# Full local load-test sequence against the staging stack (synthetic data only).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; RUN="${STACK_DIR:-/tmp/peb-stack}"; OUT="${OUT_DIR:-$RUN/load}"; mkdir -p "$OUT"
K6="${K6_BIN:-k6}"; DB=peb_stage; ENTRIES="${ENTRIES:-200}"
set -a; . "$RUN/app.env"; set +a
export STAGING_PASSWORD='Staging-Only-Password-1' APP_URL="${APP_URL:-http://127.0.0.1:3100}"
q() { psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-54329}" -U postgres -d "$DB" -Atqc "$1"; }
ADMIN=$(q "select id from admins where email='admin@staging.local'")

echo "== reset staging round state"
q "select round1_control('stop', '$ADMIN', null)" >/dev/null
q "select competition_reset('$ADMIN', 'RESET COMPETITION')" >/dev/null
q "update auth_sessions set ended_at = now(), end_reason = 'load_reset' where ended_at is null; delete from rate_limits;"
curl -s 127.0.0.1:54340/reset >/dev/null
# API tests re-issue a few PINs; put every synthetic entry back on its deterministic staging PIN.
( cd "$HERE/../.." && npx tsx tests/stack/restore-pins.ts "$DB" "$ENTRIES" )

echo "== scenario 1: login burst ($ENTRIES simultaneous)"
"$K6" run --quiet --summary-export "$OUT/login-burst.json" -e ENTRIES="$ENTRIES" -e EVENT_SECRET="$EVENT_SECRET" "$HERE/login-burst.js" | tee "$OUT/login-burst.txt" | tail -25 || true
q "update auth_sessions set ended_at = now(), end_reason = 'load_reset' where ended_at is null; delete from rate_limits;"

echo "== start round (load-test config: 200s challenge timer so all timers expire together mid-test)"
q "update rounds set config = config || '{\"challenge_seconds\": 200}'::jsonb where round_number = 1"
q "select round1_control('start', '$ADMIN', null)"

echo "== scenarios 2-6: arena + dashboards + desk + expiry storm"
"$K6" run --quiet --summary-export "$OUT/event-day.json" -e ENTRIES="$ENTRIES" -e EVENT_SECRET="$EVENT_SECRET" -e STAGING_PASSWORD="$STAGING_PASSWORD" "$HERE/event-day.js" | tee "$OUT/event-day.txt" | tail -60 || true
echo "== integrity checks"
q "select 'entries_with_assignments', count(distinct entry_id) from challenge_assignments"
q "select 'duplicate_refs_per_entry', count(*) from (select entry_id from submissions where submission_ref is not null group by entry_id having count(distinct submission_ref) > 1) x"
q "select 'duplicate_jobs', count(*) - count(distinct submission_id) from evaluation_jobs"
q "select 'positions_locked_or_submitted', status, count(*) from submissions group by status order by 2"
q "select 'versions_rows', count(*) from submission_versions"
q "select 'live_sessions_per_entry_gt1', count(*) from (select entry_id from auth_sessions where ended_at is null and entry_id is not null group by entry_id having count(*) > 1) x"

echo "== stop round (finalize everything) and run AI evaluation with mock Gemini"
q "select round1_control('stop', '$ADMIN', null)"
COOKIE=$(curl -s -i -X POST "$APP_URL/api/organizer/login" -H 'Content-Type: application/json' -d "{\"email\":\"admin@staging.local\",\"password\":\"$STAGING_PASSWORD\"}" | grep -i '^set-cookie' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //; s/;.*//')
START=$(date +%s)
for i in $(seq 1 60); do
  R=$(curl -s -X POST "$APP_URL/api/admin/evaluations" -H 'Content-Type: application/json' -H "Cookie: $COOKIE" -d '{"action":"run"}')
  echo "   batch $i: $R"
  REM=$(echo "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).remaining)}catch{console.log(-1)}})')
  [ "$REM" = "0" ] && break
  [ "$REM" = "-1" ] && break
  sleep 2
done
echo "   evaluation wall time: $(( $(date +%s) - START ))s"
q "select 'jobs', status, count(*) from evaluation_jobs group by status"
q "select 'ai_evaluations', count(*), count(distinct submission_id) from ai_evaluations"
q "select 'submissions_total', count(*) from submissions"
echo "   mock gemini: $(curl -s 127.0.0.1:54340/stats)"

echo "== reset while an evaluation batch is in flight"
q "update evaluation_jobs set status = 'queued', retry_count = 0, next_attempt_at = now(); delete from ai_evaluations;"
( curl -s -X POST "$APP_URL/api/admin/evaluations" -H 'Content-Type: application/json' -H "Cookie: $COOKIE" -d '{"action":"run"}' > "$OUT/inflight-eval.json" ) &
sleep 3
RESET=$(curl -s -w ' HTTP %{http_code}' -X POST "$APP_URL/api/admin/competition/reset" -H 'Content-Type: application/json' -H "Cookie: $COOKIE" -d '{"confirm":"RESET COMPETITION"}')
wait
echo "   reset: $RESET"
echo "   in-flight eval batch returned: $(cat "$OUT/inflight-eval.json")"
q "select 'after_reset', (select count(*) from challenge_assignments), (select count(*) from submissions), (select count(*) from evaluation_jobs), (select count(*) from ai_evaluations), (select string_agg(status, ',') from rounds)"
q "select 'kept', (select count(*) from entries), (select count(*) from entries where pin_hash is not null), (select count(*) from entries where present), (select count(*) from challenges)"
q "update rounds set config = config || '{\"challenge_seconds\": 450}'::jsonb where round_number = 1"
