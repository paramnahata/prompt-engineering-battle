# Prompt Engineering Battle

AI Prompt Optimization & Problem-Solving Challenge — event management and
live competition platform for a ~60-80 entry college technical event.

Individual OR 2-person team **entries** compete in Round 1 (4 AI-scored
prompt-engineering challenges, 30 min, 50 marks) and a Round 2 final
(real-world problem + jury interaction, 100 marks) for the top ~15% of
entries.

## Status

Implemented and tested: registration and check-in, per-team PINs, challenge
pool import with difficulty rules, Round 1 (timed challenges, autosave, AI
evaluation, results), Round 2 (problem pack import from .docx, one problem
per team with its own surprise twist, phone-friendly jury view with suggested
questions and marks per question, system (AI) + jury score, declared winners),
results publication to students, targeted announcements, CSV exports, a
deployment health check and a global competition reset with preview.
See **[docs/EVENT_READINESS.md](docs/EVENT_READINESS.md)** for the audit,
security review, authorization matrix, test and load-test results, the
deployment runbook and the go/no-go checklist.

## Tests

```bash
npm test                         # unit tests
PGHOST=/tmp PGPORT=54329 npm run test:db   # SQL functions against a local Postgres (tests/db/reset.sh)
tests/stack/start.sh 220         # local staging stack: Postgres + PostgREST + next start + mock Gemini
tests/api/run.sh                 # HTTP authorization + end-to-end flow against that stack (resets synthetic sessions/PINs first)
tests/db/rollback.sh             # migrations 0004/0005 up → down → up on a scratch DB
tests/load/run-local.sh          # k6 load test (200 students) — staging/synthetic data only
```

## Tech stack

Next.js 14 (App Router, TS) · Tailwind + shadcn-style components ·
Supabase Postgres + Realtime · Zod · React Hook Form · Zustand · PapaParse ·
Gemini 2.5 Flash (server-only) · Vercel

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values, see below
npm run dev
```

## Supabase setup

1. Create a project at supabase.com.
2. Apply `supabase/migrations/0001` … `0007` in order (SQL editor or
   `supabase db push`). `0003` is a no-op on the original production
   database; `0004` adds sessions, rate limits and the competition SQL
   functions; `0005` adds team PINs, the challenge pool workflow and the
   global reset; `0006` adds Round 2, results publication, announcement
   targeting and `app_schema_status()`; `0007` adds the Round 2 problem
   pack, per-problem twists and per-question jury marks (all callable only with the
   service-role/secret key). `GET /api/health` reports whether the database
   the deployment points at has every migration.
   Rollback scripts are in `supabase/rollback/`.
3. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-only). The browser
   never talks to Supabase directly.
4. Seed `rounds` (round_number 1 with `config.challenge_seconds` /
   `round_duration_seconds`), at least one admin account, and the challenge
   pool (Challenge pool → Import); then pick Common A/B and the difficulty
   rules, and generate team PINs on the Registration desk.

## Gemini setup

Save the key in Admin → AI Judging (validated, encrypted at rest) or set
`GEMINI_API_KEY`. Evaluation runs from the dashboard's "Run evaluation"
button; an optional cron needs `CRON_SECRET`.

## CSV format for participant import

Headers are auto-detected (case/punctuation-insensitive), e.g.
`SR.NO | ID | NAMES | Team Name | PHONE NO: | E-MAIL | GENDER | COLLEGE | CITY | BRANCH | YEAR | DATE/TIME`.
Teams spanning consecutive rows with merged (blank) group cells are grouped;
each member keeps their own email/phone. Preview shows every team before
anything is written; re-importing the same file is a no-op.

## Deployment to Vercel

1. Set the variables from `.env.example` in Project Settings.
2. Apply migrations before (or together with) deploying new code.
3. Note: preview deployments use the same env vars — i.e. the production
   database — unless you scope them differently.

## Security notes

- Gemini key, Supabase service-role key, `SESSION_SECRET`, `PIN_PEPPER`
  are server-only. Confirm none of them ever get a `NEXT_PUBLIC_` prefix.
- All privileged mutation happens through route handlers using
  `requireRole()` + explicit ownership checks — the browser's Supabase
  client only has the anon key and RLS denies it direct table access.
- Admin overrides (time extension, unlock, disqualify, etc.) must be
  written to `admin_actions` — the table and pattern exist
  (`src/app/api/admin/participants/import/route.ts` shows the pattern);
  every new admin route needs to follow it.

## Event-day checklist (fill in once remaining phases are built)

- [ ] Run migrations on production Supabase project
- [ ] Import + validate final participant CSV
- [ ] Mark attendance, confirm PRESENT counts
- [ ] Confirm ≥4 active challenges, generate Round 1 assignments once
- [ ] Start Round 1 from admin dashboard, monitor evaluation queue counters
- [ ] Review results, release Round 2 qualification
- [ ] Run Round 2, lock jury scores, release final results
- [ ] Keep `/display` open on the projector throughout
