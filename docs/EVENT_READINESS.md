# Event-readiness report — Prompt Engineering Battle (SWAYAMBHU 2026)

Branch `hardening/event-readiness`, based on `main` @ `0e37ab2` (production deployment of that commit was **READY** on Vercel when this work started).

Everything below was verified by running code — the commands and outputs are in §6. Where something was **not** verified it says so.

---

## 1. Audit (Phase A) — what was found

### What already worked
- Signed HttpOnly session cookies with constant-time signature check and role whitelist (commit `0e37ab2`).
- Organizer login rejected unknown DB roles (`7b5f801`).
- Per-route role checks on every admin API; ownership check on student autosave/advance.
- Server-authoritative per-challenge timer stored in `submissions.question_end_at`, client countdown re-synced to server time.
- RLS enabled on every table with no anon policies except `rounds`/`announcements` read.
- Gemini key stored AES-256-GCM encrypted, never returned by the API.
- `tsc` and `next build` passed.

### Broken / incomplete (verified)
| # | Problem | Evidence |
|---|---|---|
| B1 | AI evaluation never ran: `vercel.json` was `{}` (no cron), no "Run evaluation" button, qualification never computed | `vercel.json`, `grep computeRound1Results` → unused |
| B2 | **Stop lost work**: un-submitted drafts were never submitted or evaluated after Stop | `round1/stop/route.ts` only flipped status |
| B3 | **Pause did not pause time**: no deadline was shifted on resume | `round1/control/route.ts` |
| B4 | Round never auto-ended at its deadline | no code path |
| B5 | Common challenges = "first two rows Postgres returns" (unordered); 5 `GK-*` test and 6 `CH-*` demo challenges active in production | `assignment-engine.ts`, live DB |
| B6 | Login-activity panel still showed `ENTRY-001`: regex literal `/(\\d+)$/` matches a backslash | `AdminDashboardClient.tsx:234` |
| B7 | Multi-word desk search never matched: `split(/\\s+/)` | `RegistrationDeskClient.tsx:67,428` |
| B8 | "Offline — changes saved locally" was false (nothing saved locally); last ~1.5 s of typing lost at timer expiry | `student/round1/page.tsx` |
| B9 | Display page's Supabase Realtime subscription never fired (tables not in the publication) | live `pg_publication_tables` |
| B10 | Logout only deleted the cookie; "online" panel was login history | `session.ts`, `student-logins/route.ts` |
| B11 | Lint not configured; 4 production migrations missing from the repo; `tsconfig.tsbuildinfo` committed | repo / `supabase_migrations` |

### Security findings
See §4 for the full table. Critical: anyone on the internet could sign in as any student (public access code + sequential entry numbers + no rate limit); the evaluation cron route was publicly callable (no `CRON_SECRET` in Vercel).

### Data-integrity
- Start/submit/evaluate were multi-request sequences without locks → double-click/second-tab races (double assignment generation, two submission refs, the same submission evaluated and billed twice).
- `participants DELETE` could erase all submissions mid-event.
- CSV import: fill-down logic copied the *first* row's contact into "member 2" for some mappings; no per-member college/branch; `ENTRY-###` codes > 999 would collide.

### Performance
- Autosave = 5–6 sequential DB round trips; state = 3–5; a version row on every save.
- Waiting room polled every 3 s, arena every 10 s, with no jitter (synchronised bursts).

### Build / deploy
- No blockers at `0e37ab2`. Preview deployments use the **production** database (same env vars for all targets).

---

## 2. What changed

### Architecture
- **Sessions** are rows in `auth_sessions`; the cookie (`__Host-peb_session`, HttpOnly, Secure, SameSite=Lax, 12 h) carries an HMAC-signed pointer. Every protected request validates the row *and* that the account still exists with the same role, so logout, password reset, account deletion, demotion and disqualification take effect immediately. Login always creates a new id (no fixation).
- **All competition state changes are single SQL functions** (one transaction, row locks): `round1_control` (start/pause/resume/stop/reset/assign late arrivals), `student_round1_state`, `student_autosave`, `student_advance`, `claim_evaluation_jobs`, `compute_round1_results`, `import_participants`, `student_login`. Only `service_role` may execute them.
- The browser no longer uses the Supabase key at all; everything goes through authenticated API routes.

### Files
| Area | Files | Why |
|---|---|---|
| Schema | `supabase/migrations/0003_reconcile_production_schema.sql` | Brings the 4 production-only migrations into the repo (idempotent no-op on prod) |
| | `supabase/migrations/0004_event_readiness.sql` | Entry numbers, per-member fields, common slots, sessions, rate limits, all SQL functions, indexes, privileges |
| Auth | `src/lib/auth/token.ts`, `session.ts`, `student.ts`, `src/middleware.ts`, `next.config.mjs` | DB-backed sessions, guards, CSRF origin check, size limits, security headers |
| Auth routes | `api/student/login`, `api/organizer/login`, `api/auth/*`, `api/student/heartbeat` (new); removed `api/admin/login`, `api/judge/login` (unused duplicates) | Rate limiting, one device per entry, revocation, heartbeat |
| Round 1 | `api/admin/round1/control`, `api/admin/round1/status` (new); removed `start`/`stop`/`reset` routes; `api/student/round1/*` | Server-enforced transitions; atomic autosave/advance |
| Evaluation | `src/lib/gemini/evaluator.ts`, `src/lib/evaluation/queue.ts`, `api/admin/evaluations` (new), `api/cron/process-evaluations`; removed `assignment-engine.ts`, `qualification.ts` (moved to SQL) | Timeouts, schema-validated output, injection-safe input, exactly-once claiming, retry/failure workflow |
| Results | `api/admin/results` (new) | Compute + leaderboard |
| Challenges | `api/admin/challenges`, `admin/challenges/page.tsx`, `ChallengePoolClient.tsx` (new) | Choose Common A/B, enable/disable pool |
| Participants | `src/lib/csv/import.ts`, `api/admin/participants/*`, `api/admin/attendance`, `api/admin/sessions/release` (new), `src/lib/participant-search.ts`, `src/lib/entries.ts` | Import rewrite, instant search, numeric entry numbers, device release |
| Live status | `api/admin/student-logins`, `LiveParticipantsPanel.tsx`, `useHeartbeat.ts` | Online/idle/offline from heartbeats |
| UI | `AdminDashboardClient.tsx`, `RegistrationDeskClient.tsx`, `CsvImportPanel.tsx`, `AccessCodePanel.tsx`, `EntriesListClient.tsx`, `EntryDetailClient.tsx`, `student/*` components, `display/DisplayScreen.tsx`, `OrganizerShell.tsx`, `usePolling.ts`, page wrappers | Server-side page guards, honest save status, local draft backup, pause overlay, typed Start Over dialog, back navigation, loading/empty/error states |
| Tests | `tests/unit`, `tests/db`, `tests/api`, `tests/stack`, `tests/load`, `tests/fixtures` | See §6 |
| Config | `.eslintrc.json`, `.env.example`, `.gitignore`, `package.json` | Lint, documented env vars, test scripts; removed unused `@supabase/ssr` |

### Database changes (migration 0004 — additive, backward compatible)
- `entries.entry_number integer not null unique` (backfilled from `entry_code`; a trigger fills it for inserts that omit it, so the *old* app keeps working if the migration is applied first).
- `team_members`: `gender, college, city, branch, study_year, source_row`; member_position now 1–4.
- `challenges.common_slot` (1 or 2, unique).
- New tables `auth_sessions`, `rate_limits` (RLS on, no browser access).
- `evaluation_jobs.next_attempt_at, model, rubric_version`; `ai_evaluations.model, rubric_version`.
- Indexes on real query paths (assignments by round, versions by submission+time, job claiming, reviews, activity logs, results).
- `search_path` pinned on existing functions (Supabase advisor).
- Read-only checks against production confirmed compatibility: no entry-code collisions, no name clashes, no out-of-range member positions.

---

## 3. Competition rules as implemented
- Students sign in with **entry number** (`7`, also accepts `07`, `#7`, `ENTRY-007`) + the 4-digit rotating code (valid 2 min, plus 20 s grace after rotation).
- Only checked-in, non-disqualified entries can sign in. One live device per entry (a device counts as live for 60 s after its last heartbeat); the desk can release it.
- Start assigns: challenge 1 = Common A, 2 = Common B, 3–4 = two different challenges from the shuffled active pool, round-robin so usage differs by at most one. Late arrivals: "Assign late arrivals".
- Each challenge timer (450 s, capped at the round end) starts when the student first opens it. "Next" opens only when the timer ends; at expiry the client submits automatically with the latest text (accepted up to 15 s late). If a student is away, the server closes out expired challenges on their next visit.
- Pause freezes every timer; Resume adds the exact paused time to the round and to each in-progress challenge.
- Stop — or the round deadline passing — submits every outstanding answer as-is and queues it for evaluation.
- Start Over requires typing `START OVER`; deletes Round 1 assignments, answers, versions, evaluations, overrides and results; keeps participants, attendance, accounts and the challenge pool; audited.
- Score per challenge 0–50 (five 0–10 criteria, total computed server-side); entry score = sum of four (max 200); latest manual override wins; ties at the qualification cutoff all qualify.

---

## 4. Security audit

| # | Severity | Finding (evidence) | Fix | Remaining risk |
|---|---|---|---|---|
| S1 | **Critical** | Access code public at `/api/access-code` and on unauthenticated `/display`; entry numbers sequential; no rate limit → remote takeover of any entry | Code + display require an organizer session; per-entry failure lock (8 / 5 min), per-IP cap (600 / min, NAT-friendly); check-in required; one live device per entry | Someone **inside the room** who sees the code can still try another team's number. Mitigated by "one live device" (a team that is signed in can't be hijacked) and the desk's Release. A per-entry PIN would close it fully (not implemented). |
| S2 | **Critical** | `/api/cron/process-evaluations` callable by anyone (no `CRON_SECRET` set) → Gemini quota abuse | Route disabled unless `CRON_SECRET` (≥16 chars) is set; constant-time bearer check | — |
| S3 | High | Logout only cleared the cookie; stolen cookie valid 12 h; password reset/deletion didn't sign out | Server-side sessions; revocation on logout / reset / delete / release / disqualification / role change | If `SESSION_SECRET` leaks, tokens can be forged but still need a live DB session row (tested) |
| S4 | High | Race conditions: double start, double submit refs, duplicate evaluation (and billing) | Row-locked SQL functions; `FOR UPDATE SKIP LOCKED` job claiming | — (tested with concurrent calls) |
| S5 | High | Destructive admin actions without server-side safeguards (participants wipe mid-event; reset with only client confirm) | Server requires typed confirmations; participant wipe refused once Round 1 has data; all audited | Admins can still Start Over after a round — by design |
| S6 | Medium | `/admin/login` route defaulted any non-volunteer role to admin | Route removed (the organizer login only accepts known roles) | — |
| S7 | Medium | No CSRF defence beyond SameSite=Lax | Origin / Sec-Fetch-Site check on every mutating API request | Non-browser clients without Origin still need a valid session |
| S8 | Medium | No security headers | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS, COOP; `X-Powered-By` removed | CSP allows `'unsafe-inline'` scripts (required by Next.js without nonces) |
| S9 | Medium | Prompt injection into the AI judge (raw text concatenation) | Participant text passed as JSON-encoded data; system prompt treats it as untrusted; schema-constrained output; total recomputed server-side; scores clamped | LLM judging is never fully injection-proof; the admin can review flags and override any score |
| S10 | Medium | DB/internal error messages returned to clients (`error.message`) | Generic messages; details only in server logs | — |
| S11 | Low | Open-redirect check missed `/\evil.com` | `safeNextPath` (server-side) rejects backslashes, `//`, control chars, absolute URLs | — |
| S12 | Low | Unlimited request bodies; free-form `event_type`/metadata in activity log | Size limits (middleware + per route), zod schemas, fixed event-name enum | — |
| S13 | Low | Weak password minimum (6) | 8 characters; last admin cannot be deleted | — |
| S14 | Info | SQL injection | All queries use the Supabase query builder or parameterised RPC arguments; no string-built SQL in the app. SQL functions take typed parameters. Tested with injection strings | — |
| S15 | Info | Service key exposure | Only in server modules (`server-only` import guard); browser bundle has no Supabase key | — |
| S16 | Info | Dependencies (`npm audit --omit=dev`) | Next 14.2.35 is flagged (fix only in Next 16 — a major upgrade not appropriate days before an event); others are build-time (tailwind/postcss/glob) | Accepted; re-evaluate after the event |

### API authorization matrix (enforced server-side, tested in `tests/api/authz.test.ts`)
| Endpoint | none | student | volunteer | judge | admin |
|---|---|---|---|---|---|
| `GET /api/access-code`, `GET /api/display/stats` | 401 | 403 | ✓ | ✓ | ✓ |
| `GET /api/admin/participants`, `POST /api/admin/attendance`, `GET /api/admin/student-logins`, `POST /api/admin/sessions/release` | 401 | 403 | ✓ | 403 | ✓ |
| `DELETE /api/admin/participants`, `POST /api/admin/participants/import` | 401 | 403 | 403 | 403 | ✓ |
| `/api/admin/round1/*`, `/api/admin/challenges`, `/api/admin/evaluations`, `/api/admin/results`, `/api/admin/entries/:id/round1`, `/api/admin/users`, `/api/admin/ai-settings` | 401 | 403 | 403 | 403 | ✓ |
| `/api/student/round1/*`, `/api/student/heartbeat`, `/api/student/waiting/state`, `/api/student/log` | 401 | ✓ (own entry only) | 403 | 403 | 403 |
| `GET /api/cron/process-evaluations` | bearer `CRON_SECRET` only | | | | |
| `POST /api/student/login`, `POST /api/organizer/login` | public, rate-limited | | | | |

Every row was also tested with an **expired**, **tampered** (role edited), **invalid-role** and **revoked** (validly signed, no DB row) session → 401; and student A against student B's submission → 403.

---

## 5. Required environment variables (names only)
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET` (≥32 chars), `EVENT_SECRET` — required.
`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_CONCURRENCY`, `CRON_SECRET` — optional.
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` — no longer used.

---

## 6. Test results

All runs on the feature branch, local machine (2 vCPU, 7 GB RAM), synthetic data only. Nothing destructive was run against production; production was only read (schema/compatibility checks).

| Check | Command | Result |
|---|---|---|
| Install from lockfile | `npm ci` | ✅ |
| Typecheck | `npx tsc --noEmit` | ✅ 0 errors (no `any` casts or ignore directives added to silence errors) |
| Lint (newly configured) | `npx next lint` | ✅ no warnings or errors |
| Production build | `npx next build` | ✅ all 45 routes compiled, middleware 26.8 kB |
| Unit tests | `npm test` | ✅ 19/19 — session tokens (tampering, expiry, role whitelist), access code + grace, open-redirect guard, entry-number parsing, CSV import (merged cells, BOM/CRLF, quotes, wide sheets, duplicates, oversize), search, evaluator validation/injection encoding, backoff/redaction |
| Database function tests | `PGHOST=/tmp PGPORT=54329 npm run test:db` | ✅ 25/25 — lifecycle (start refusal, balanced assignment, double start, timer start-once, pause/resume exact shift, late arrivals, stop/auto-end finalization, Start Over scope), autosave/advance rules + IDOR + concurrency (8 parallel final submits → 1 ref, 4 jobs), login rules (attendance, disqualification, one device, idempotent re-login, brute-force + IP limits), session revocation, live status, exclusive job claiming + stuck-job reclaim + bounded retries, results with overrides and ties, atomic idempotent import, browser roles denied, migration on legacy-shaped data + old-app inserts |
| API tests (local stack: Postgres → PostgREST → `next start`) | `npm run test:api` | ✅ 14/14 — 31 endpoints × {no session, expired, tampered, invalid role, revoked} → 401; role matrix → 403/allowed; IDOR; CSRF; logout replay; login rate limits + uniform errors + SQLi input; open redirects; page guards; security headers + cookie flags; body limits; cron closed; full journey import → check-in → login → device release → start → autosave → pause/resume → advance ×4 → stop → AI evaluation → results → logout |
| Supabase advisors (production, read-only) | MCP `get_advisors` | Informational only before this change; 0004 fixes the two `function_search_path_mutable` warnings |

### Load test — 200 concurrent students (k6, local staging stack)
Acceptance criteria were fixed before running (see `tests/load/README.md`). Stack: Next.js production server (single Node process), PostgREST, Postgres 16 and k6 with 200 virtual users all on the same 2-vCPU machine; mock Gemini with 200–1200 ms latency and ~7% injected 429/500 errors. Runner: `tests/load/run-local.sh`.

| Scenario | Volume | p50 | p95 | max | Errors | Target | Result |
|---|---|---|---|---|---|---|---|
| 200 simultaneous student logins | 200 req | 857 ms | 1.23 s | 1.29 s | 0 | p95 < 2 s, < 1% | ✅ |
| 200 students active, 4 min (autosave ~5 s, status poll, heartbeat, state refresh) | 26,397 req, ~99 req/s | 13 ms | 379 ms | 4.6 s | 28 (0.10%) | p95 < 800 ms, < 0.5% | ✅ |
| — autosave only | 10,574 req | 11 ms | 53 ms | 1.7 s | 28 | p95 < 800 ms | ✅ |
| Admin dashboard (status + live participants + display) during load | 2 VUs | 29 ms | 111 ms | 2.0 s | 0 | p95 < 1.5 s | ✅ |
| Registration desk (participant list + access code) during load | 3 VUs | 24 ms | 202 ms | 3.1 s | 0 | p95 < 1.5 s | ✅ |
| **Timer-expiry storm**: all 200 timers expire together, each client sends advance twice (400 req in ~1 s) | 400 req | 586 ms | **3.91 s** | 4.24 s | 0 | p95 < 2.5 s | ❌ on this hardware — see note |
| AI evaluation of 884 answers (400 non-empty) | 428 model calls | — | — | 227 s wall | 0 failed after retries | each answer exactly once | ✅ 400 successful model calls = 400 non-empty answers; 484 empty answers scored 0 without a call; 28 injected errors all retried |

p99 was not captured in the exported summary; max is shown instead.

**Integrity after the storm:** 200 challenges locked (exactly one per entry), 0 entries with more than one submission reference, 0 duplicate evaluation jobs, 0 entries with more than one live session, 0 unexpected 409s.

**Notes**
- The 28 errors were all TCP "connection reset by peer" on autosave: k6 reuses keep-alive sockets after 4–6 s idle while `next start` closes them at 5 s. This is specific to a single self-hosted Node server; the student page retries a failed autosave automatically and keeps a local copy.
- The storm miss is app-tier CPU on this 2-vCPU box (k6 + Node + PostgREST + Postgres competing). Measured directly against the database, 400 concurrent advance calls finish in **265 ms total (p95 264 ms)** and 200 concurrent state loads in 378 ms, with exactly 200 rows locked. On Vercel the app tier scales out per request, so the database — which is fast here — is the shared bottleneck. Real timers are also staggered by a few seconds (each starts when the student opens it).
- **Not tested:** Vercel + Supabase at 200 users. Preview deployments use the production database, so a real-infrastructure test needs a separate Supabase project or branch first.

---

## 7. Deployment runbook (needs your go-ahead)
1. Review the PR.
2. Apply `0003` then `0004` to production Supabase (both additive; `0004` is safe with the currently deployed code because of the entry-number trigger).
3. Merge → Vercel production deploy. Everyone (organizers and any signed-in student) must sign in again — old cookies use the previous format.
4. On the Challenge pool page: choose Common A and B; deactivate test/demo challenges (`GK-*`, `CH-*`) if they shouldn't be used.
5. AI Judging: confirm the key works; check your Gemini quota (see limitations).
6. Smoke test on production with a test entry, then **Start Over** to clear it.
7. Optional: set `CRON_SECRET` and a Vercel cron (Pro plan for sub-daily) — not required.

## 8. Known limitations
- **Load tests ran on a 2-CPU local stack**, not on Vercel + Supabase. They prove correctness under 200-way concurrency and give an upper bound on latency for this hardware; a staging run on real infrastructure is still recommended (needs a separate Supabase project/branch — preview deployments currently point at the production database).
- **Gemini quota**: ~800 evaluations for 200 entries. At the free-tier limit (~10 requests/min for 2.5 Flash) that is ~80 minutes; with paid tier and `GEMINI_CONCURRENCY=4` it is a few minutes. Rate-limit errors back off and retry automatically; failures are listed with a Retry button.
- UI was verified by build/lint and HTTP tests, not by screenshots in a real browser.
- Round 2 / judge scoring is not implemented (unchanged from before).
- In-room impersonation risk (S1 remaining risk).

## 9. Go / no-go
**Conditional GO**, once these are done:
1. Apply migrations 0003 + 0004 and deploy this branch (needs your approval). Smoke-test production with one test entry, then Start Over.
2. Choose Common A/B and disable test challenges on the Challenge pool page.
3. Confirm the Gemini key's quota covers ~800 evaluations (or plan ~80 min of evaluation on the free tier).
4. Brief the desk: entry numbers, "Release device", and that the projector page needs an organizer login.

Strongly recommended before event day: one rehearsal with 10–20 real devices on the venue Wi-Fi, and (if you can create a separate Supabase project/branch) a k6 run against a Vercel preview pointed at it.

Without step 1 the current production version is **NO-GO**: anyone online can sign in as any checked-in entry, and AI evaluation never runs.
