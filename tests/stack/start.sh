#!/usr/bin/env bash
# Local staging stack: Postgres (repo migrations + synthetic data) → PostgREST → /rest/v1 proxy → next start.
# Usage: PGHOST=/tmp PGPORT=54329 POSTGREST_BIN=/path/postgrest tests/stack/start.sh [entries]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
DB=peb_stage; ENTRIES="${1:-220}"; RUN="${STACK_DIR:-/tmp/peb-stack}"; mkdir -p "$RUN"
pkill -f "[p]ostgrest $RUN" 2>/dev/null || true; pkill -f "[p]roxy.mjs" 2>/dev/null || true; pkill -f "[m]ock-gemini.mjs" 2>/dev/null || true; pkill -f "[n]ext start -p 3100" 2>/dev/null || true; pkill -f "[n]ext-server" 2>/dev/null || true
"$ROOT/tests/db/reset.sh" "$DB" >/dev/null
export SESSION_SECRET=local-staging-session-secret-0123456789abcdef
( cd "$ROOT" && npx tsx tests/stack/seed-staging.ts "$DB" "$ENTRIES" )

JWT_SECRET="local-staging-jwt-secret-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
SERVICE_KEY=$(node -e '
const c=require("crypto");const s=process.argv[1];const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",iss:"local",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400*7});
console.log(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"))' "$JWT_SECRET")
cat > "$RUN/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@/$DB?host=${PGHOST:-/tmp}&port=${PGPORT:-54329}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = 54330
db-pool = 40
CONF
nohup "${POSTGREST_BIN:-postgrest}" "$RUN/postgrest.conf" > "$RUN/postgrest.log" 2>&1 &
nohup node "$HERE/proxy.mjs" > "$RUN/proxy.log" 2>&1 &
nohup node "$HERE/mock-gemini.mjs" > "$RUN/mock-gemini.log" 2>&1 &
cat > "$RUN/app.env" <<ENV
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=$SERVICE_KEY
SESSION_SECRET=$SESSION_SECRET
EVENT_SECRET=local-staging-event-secret
CRON_SECRET=local-staging-cron-secret-123456
GEMINI_API_KEY=mock-key-not-real
GEMINI_API_BASE_URL=http://127.0.0.1:54340
ENV
sleep 2
( cd "$ROOT" && set -a && . "$RUN/app.env" && set +a && setsid nohup npx next start -p 3100 > "$RUN/next.log" 2>&1 < /dev/null & )
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:3100/ && break; sleep 1; done
echo "stack up: app http://127.0.0.1:3100 (env in $RUN/app.env)"
