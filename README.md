# Prompt Engineering Battle

AI Prompt Optimization & Problem-Solving Challenge — event management and
live competition platform for a ~60-80 entry college technical event.

Individual OR 2-person team **entries** compete in Round 1 (4 AI-scored
prompt-engineering challenges, 30 min, 50 marks) and a Round 2 final
(real-world problem + jury interaction, 100 marks) for the top ~15% of
entries.

## ⚠️ Build status — read this first

This repository is a **working foundation**, not the finished event
platform. Given the scope of this spec (14 phases, 20+ tables, 4 portals),
it was built in this order so every later phase has something solid to
stand on:

**Implemented (real, working code):**
- Full normalized Postgres schema + RLS (`supabase/migrations/`)
- Auth: admin/judge password login, student Entry ID + rotating access
  code, signed HTTP-only session cookies (`src/lib/auth/`)
- Rotating Event Access Code, server-time authoritative (`src/lib/security/access-code.ts`)
- Server-authoritative countdown timer + client resync hook (`src/lib/timer/`, `src/hooks/useServerCountdown.ts`)
- CSV import: header parse → column mapping → validation/dedupe preview →
  confirm-and-insert, generates `ENTRY-###` codes (`src/lib/csv/import.ts`,
  `src/app/api/admin/participants/import/route.ts`)
- Round 1 challenge assignment engine: 2 common + 2 load-balanced random,
  idempotent/permanent (`src/lib/evaluation/assignment-engine.ts`)
- Gemini structured-JSON evaluator + bounded-concurrency retry queue
  (`src/lib/gemini/evaluator.ts`, `src/lib/evaluation/queue.ts`) driven by
  Vercel Cron (`vercel.json`, `src/app/api/cron/process-evaluations`)
- Round 1 qualification calculator (configurable top-N%, human review
  override wins over AI score) (`src/lib/evaluation/qualification.ts`)
- A real Round 1 student competition page: server-synced timer, debounced
  autosave, copy/paste/context-menu deterrence, tab/blur logging
  (`src/app/student/round1/page.tsx`)
- Display screen wired to Supabase Realtime for round status + announcements

**Scaffolded but not yet built out** (folders exist under
`src/app/admin/*`, `src/app/judge/*`; needs real pages + API routes):
- Admin dashboard, attendance UI, challenge pool CRUD, live monitoring,
  Round 1 admin controls (start/pause/extend/override + audit logging),
  human review interface, result release screens
- Round 2 full state machine UI + API routes for each transition, surprise
  twist broadcast, Round 2 AI evaluator
- Judge portal (login, finalist queue, scoring form, lock)
- Final results aggregation + release screen
- Demo mode / reset-event admin function
- Seed script, Playwright/load tests

**Recommended next steps**, in the order the spec itself lays out in
"Development Order": Phase 4 (attendance UI) → Phase 5 (challenge pool
CRUD + "Generate Assignments" button) → Phase 6 (Round 1 admin controls) →
Phase 7 (live monitoring) → Phase 8 (evaluation dashboard) → Phase 9
(results release) → Phase 10-12 (Round 2 + Judge portal) → Phase 13
(display polish) → Phase 14 (demo mode, load test).

## Tech stack

Next.js 14 (App Router, TS) · Tailwind + shadcn-style components ·
Supabase Postgres + Realtime · Zod · React Hook Form · Zustand · PapaParse ·
Gemini 2.5 Flash (server-only) · Vercel (hosting + cron)

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values, see below
npm run dev
```

## Supabase setup

1. Create a project at supabase.com.
2. Run the migrations in order (SQL editor, or `supabase db push` with the
   CLI): `supabase/migrations/0001_init_schema.sql`, then `0002_rls.sql`.
3. Copy the project URL and keys into `.env.local`:
   - `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` — same value
   - `SUPABASE_SECRET_KEY` — the **service role** key. Server-only. Never
     prefix this with `NEXT_PUBLIC_`.
   - `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` —
     the **anon** key. Safe to expose; RLS denies it direct table access
     by default (see `0002_rls.sql`) so it's only used for Realtime.
4. Seed `event_settings`, at least 2 admins, and ≥4 active `challenges`
   before you can generate Round 1 assignments (`nextEntryCode`,
   assignment engine both assume this — a seed script is a Phase 3/14 TODO).

## Gemini setup

Get an API key from Google AI Studio, put it in `GEMINI_API_KEY`
(server-only — see `next.config.mjs` comment and `src/lib/gemini/evaluator.ts`).
No client code ever touches this key.

## CSV format for participant import

Any column names are fine — the admin import UI (to be built in Phase 4)
lets you map your actual headers to: `registration_id` (required),
`member1_name` (required), `team_name`, `member1_email`, `member2_name`,
`member2_email`, `payment_status` (all optional). The import route already
does header parsing, mapping, validation, duplicate detection, and a
preview — `src/lib/csv/import.ts` + `src/app/api/admin/participants/import/route.ts`.

## Deployment to Vercel

1. Push this repo to GitHub.
2. Import into Vercel, set all `.env.example` variables in Project Settings.
3. `vercel.json` registers the evaluation-queue cron. Hobby plan cron
   minimum is 1/minute — fine for background draining; use the admin
   "RUN EVALUATION" manual trigger (calls the same route) if you need a
   burst processed immediately during the event.

## Security notes

- Gemini key, Supabase service-role key, `SESSION_SECRET`, `EVENT_SECRET`
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
