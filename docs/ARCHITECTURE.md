# Architecture — Prompt Engineering Battle

## System overview

- **Frontend/Backend**: Single Next.js 14 App Router project. Route handlers
  under `src/app/api/**` are the only code allowed to use the Supabase
  service-role key or the Gemini key.
- **Database**: Supabase Postgres. Schema in `supabase/migrations/0001_init_schema.sql`,
  RLS in `0002_rls.sql`.
- **Realtime**: Supabase Realtime (Postgres change feeds) for round status,
  announcements, and admin live-monitoring. Students subscribe only to
  channels scoped to their own `entry_id` (see `docs/REALTIME.md` — to be
  added in Phase 6/7) to avoid a full broadcast-to-everyone pattern at 80
  concurrent users.
- **AI evaluation**: A queue table (`evaluation_jobs`) drained by a Vercel
  Cron job (`/api/cron/process-evaluations`, `vercel.json`) with bounded
  concurrency (5 in-flight Gemini calls) and exponential-backoff retries.
  Vercel Hobby cron is 1-request-per-minute minimum; on Pro you can run
  every 10-15s. Admin also has a manual "RUN EVALUATION" trigger that calls
  the same route on demand.

## Auth flow

1. **Admin/Judge**: email + password (scrypt-hashed, `src/lib/auth/password.ts`)
   → signed HTTP-only cookie session (`src/lib/auth/session.ts`) with a
   `role` claim. No JWT library needed — HMAC-signed payload, verified
   server-side on every request.
2. **Student**: Entry ID + rotating Event Access Code
   (`src/lib/security/access-code.ts`, HMAC-derived from `EVENT_SECRET` and
   a 60s time window, server-clock authoritative) → same cookie session
   pattern with `role: 'student'` and `userId: entries.id`.
3. Every API route calls `requireRole(...)` and re-checks resource
   ownership (e.g. a submission's `entry_id` must equal the session's
   `userId`) — the session role is never trusted alone.

## Round state machine

- **Round 1**: `rounds.status` = `not_started → running → paused → ended`.
  Global deadline stored as `round_end_at`; per-challenge deadlines stored
  per-assignment implicitly via `submissions.question_end_at`. Client never
  computes a deadline itself — see `src/lib/timer/index.ts` and
  `src/hooks/useServerCountdown.ts` for the resync pattern.
- **Round 2**: explicit state machine on `round2_states.state`, enum-enforced
  at the DB level: `R2_WAITING → R2_STARTED → INITIAL_PROMPT → OUTPUT →
  JURY_PHASE → SURPRISE_REVEALED → REFINEMENT → FINAL_SUBMISSION →
  EVALUATION → RESULT`. API routes for each transition (Phase 10, not yet
  built) must validate the current state before allowing the next one —
  never allow skipping.

## Evaluation queue architecture

```
submission (final submit)
   -> enqueueEvaluation() inserts evaluation_jobs (status=queued)
   -> Vercel Cron hits /api/cron/process-evaluations every 1min (or admin manual trigger)
   -> processEvaluationQueue() pulls up to 20 queued jobs, MAX_CONCURRENCY=5 workers
   -> each job calls Gemini (src/lib/gemini/evaluator.ts), structured JSON only
   -> success -> ai_evaluations upsert, job.status=completed
   -> 429/5xx -> exponential backoff, retry_count++, re-queued (max 4 retries)
   -> other errors / retries exhausted -> job.status=failed, last_error stored
```

Admin dashboard reads `evaluation_jobs` grouped by status for the
"Submitted / Evaluated / Pending / Failed" counters (Phase 8/9, not yet built).

## Database ERD (textual)

- `entries` (1) — (0..2) `team_members`
- `entries` (1) — (0..1) `attendance` history rows (many, append-only)
- `rounds` (1) — (many) `challenge_assignments` — (1) `entries`, (1) `challenges`
- `challenge_assignments` (1) — (1) `submissions` — (many) `submission_versions`
- `submissions` (1) — (0..1) `evaluation_jobs`, (0..1) `ai_evaluations`, (many) `human_reviews`
- `rounds` (1) — (many) `round_results` — (1) `entries`
- `entries` (1) — (0..1) `round2_states`, (0..1) `round2_assignments` → `round2_problems`
- `entries` (1) — (many) `judge_scores` (one per judge), `judge_questions`
- `entries` (1) — (0..1) `round2_ai_evaluations`, (0..1) `final_results`
- `activity_logs` / `admin_actions` — append-only, FK to `entries`/`admins` nullable-on-delete

## What's implemented vs. remaining (see README "Build status")

This scaffold implements the structural backbone (schema, RLS, auth, the
server-authoritative timer, the CSV import pipeline, the assignment engine,
the Gemini evaluation queue, and a working Round 1 student page). Admin
dashboard screens, the Judge portal, the Round 2 state-machine UI, live
monitoring, and audit-log viewers are stubbed as route folders and need to
be built out next — see README for the phase-by-phase plan.
