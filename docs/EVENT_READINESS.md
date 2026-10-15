# Event-readiness report — Prompt Engineering Battle (SWAYAMBHU 2026)

Branch `hardening/event-readiness` (PR #4), based on `main` @ `0e37ab2` (production deployment of that commit was **READY** on Vercel when this work started).

Everything below was verified by running code; the commands and outputs are in §8. Anything that was **not** verified is marked as such.

**Production status (2026-10-15):** migrations 0003–0007 were applied by the organizer in the Supabase SQL editor (one transaction; `app_schema_status()` = v7, nothing missing; 10 entries, 18 members and 104 challenges intact). PR #4 was merged into `main` (`8017a9c`) and the Vercel production deployment is READY with `/api/health` = `database: ok, schemaVersion: 7`. Follow-up (projector redesign, room code removed) is in §0.6.

Contents:
0. Phase 3: complete platform (login 500 root cause, Round 2, results, redesigned UI, how to test) and the Round 2 event format (§0.5)
1. Audit findings (phase 1)
2. Feature summary (phases 1 + 2)
3. Competition rules as implemented
4. Security audit and role/API matrix
5. Challenge pool: file format, upload, publish, Common A/B, excluding Easy
6. Reset Competition Data: exact behaviour
7. Environment variables
8. Test results (local staging, not production)
9. Staging migration, production deployment and rollback
10. Known risks and limitations
11. Decisions and data still needed

---

## 0. Phase 3: complete platform

### 0.1 The `/api/organizer/login` HTTP 500 on the Vercel preview — root cause and fix
- **Root cause (verified).** Vercel *Preview* uses the same `SUPABASE_URL` / `SUPABASE_SECRET_KEY` as Production (checked in the Vercel project settings). The production database has none of migrations 0003–0006 (checked read-only: `rate_limit_hit` does not exist, `auth_sessions` does not exist; 11 migrations applied, the newest from 2026-10-08). The branch's login code calls `rate_limit_hit` and writes `auth_sessions`, PostgREST answers `PGRST202 Could not find the function public.rate_limit_hit…`, and the route turned that into a generic 500.
- **Reproduced locally.** A database with only 0001–0003 (production shape) behind PostgREST gives exactly that `PGRST202` for the same call.
- **What was fixed in code.**
  - Any "database is behind the code" error (`PGRST202/204/205`, `42P01`, `42883`, `42703`) now returns **HTTP 503 `setup_required`** with a clear message instead of a 500, on every route (`serverError` in `src/lib/http.ts`). The server log names the missing object; secrets are never logged.
  - New **`GET /api/health`**: public callers get `{ok, database, schemaVersion}`; a signed-in admin also gets the missing functions/tables and the *names* of missing environment variables. Backed by the new `app_schema_status()` SQL function.
  - Both sign-in pages show a banner ("This deployment's database is missing required migrations…") instead of letting people type credentials into a broken form.
  - Verified: against the production-shaped database the login returns 503 + banner; against the migrated database the same request returns 200.
- **What still has to happen (blocker, needs your approval):** apply migrations `0003 → 0004 → 0005 → 0006 → 0007` to the Supabase project the deployment uses. Until then *no* login can work on the preview, because the session and rate-limit tables don't exist there. There is no free, separate staging database available (both free Supabase project slots are in use), so the preview can only be tested after the production database is migrated — see §9.3.

### 0.2 CSP errors on the preview
Vercel injects its feedback toolbar (`vercel.live`) into **preview** deployments; our strict CSP blocked it, producing console errors. `next.config.mjs` now allows exactly the origins Vercel documents for the toolbar (`vercel.live`, `vercel.com`, `assets.vercel.com`, `wss://ws-us3.pusher.com`) **only when `VERCEL_ENV=preview`**. Production keeps the strict policy. Fonts are self-hosted (no third-party requests). A browser walk-through of 30+ screens on the local production build showed no CSP violations (the preview-only toolbar allowance itself could not be exercised outside Vercel).

### 0.3 New features
| Area | What exists now |
|---|---|
| **Round 2 (organizer-configured)** | Nothing is invented: Round 2 cannot start until an admin reviews and saves its settings (duration, common or shared-out problems, optional surprise twist, jury criteria labels and maxima, optional AI score and its weight, answer limits, final-score weights). Problems and twists are managed in the UI (expected output / criteria are jury-only). Finalists come from the Round 1 qualification (ties included) or are added by entry number. Start, pause, resume, reveal twist, stop and **start over** are atomic, audited SQL transitions; the round auto-ends at its deadline and submits everyone's work. |
| **Round 2 for students** | Stage bar (first attempt → twist → final answer → submitted), server timer, autosave with local backup, word/char limits, typed-only prompt (paste blocked), submit confirmations, idempotent final submit (one reference), jury questions answered in the page. Students never receive the expected output or the judging criteria. |
| **Jury** | Judges see each finalist's work live, ask questions, score against the configured criteria (validated against the maxima in SQL), save drafts and lock. Admins see all judges' scores, the AI evaluation, can unlock a judge's score and record an audited Round 2 override. |
| **Round 2 AI evaluation (optional)** | Same exactly-once queue design as Round 1 (`round2_eval_jobs`, `FOR UPDATE SKIP LOCKED`, retries with backoff), schema-validated Gemini output, subtotal computed server-side. |
| **Final results** | Final = Round 1 × weight + Round 2 × weight; Round 2 = average of judges + scaled AI (or the latest admin override). Refuses to compute while AI jobs are pending, teams have no jury score or scores are unlocked — unless "compute anyway". Ties share a rank. |
| **Results publication** | Nothing reaches students until an admin publishes. Per round: show score, rank, qualification, AI feedback, leaderboard (size). Publishing/unpublishing records who and when. Recomputing final results un-publishes them. |
| **Student dashboard** | Entry number, team members, a 5-step journey (registered → checked in → Round 1 → results → Round 2), live status, announcements for that team, and automatic hand-off into Round 1 / Round 2 when they start. Results page shows exactly what was published. |
| **Announcements** | Title + message to everyone, checked-in teams, Round 2 finalists, or specific entry numbers; hide/show/delete; audited. The projector only shows "everyone" messages. |
| **Organizer portal** | New sidebar shell with live Round 1 / Round 2 status and timers; Overview with real counts, setup checklist and recent activity; Round 1 and Round 2 control pages with confirmation dialogs (typed `START OVER` for start-over); Results; Announcements; Settings & health (deployment health, Round 1 timing and qualification %, CSV exports, reset with preview); Participants with filters, pagination and export. |
| **Exports (CSV)** | Participants (never PINs), login activity, Round 1 ranking, Round 1 answers & scores, Round 2 work, jury scores, final results, audit log. Admin-only, rate-limited, formula-injection-safe, audited. |
| **Reset preview** | Shows the exact counts that will be deleted and kept before typing `RESET COMPETITION`. Reset now also clears Round 2 finalists/jobs/overrides and un-publishes results; keeps Round 2 problems, twists and settings. |
| **Rate limits** | Added to evaluation runs, exports, PIN issuance, imports, reset and jury questions (per organizer). |
| **Duplicate registrations** | Manual add refuses a member whose email or phone is already registered (409 with the existing entry number); the desk can confirm "add anyway". |
| **UI** | One design system: charcoal base, violet primary, electric-blue secondary, self-hosted Bricolage Grotesque (display) + Instrument Sans (UI); buttons, badges, panels, dialogs, toasts, skeletons, empty and error states; responsive to phone width; visible focus; reduced motion respected. |

### 0.4 How to test the flows (once the database is migrated)
**Organizer.** Sign in at `/organizer/login` → Overview shows the setup checklist. Registration desk: import CSV, check teams in, "Generate missing PINs", print slips. Challenge pool: import, choose Common A/B. Round 1: Start → (students work) → Stop → Run evaluation. Results: compute, review ties, publish. Round 2: Problems/Twists → Settings (save) → Finalists ("Use Round 1 qualifiers") → Run the round: Start → Reveal twist → Stop. Jury (judge account): ask, score, lock. Results → Final: compute, publish. Settings: exports, reset preview.

**Student.** `/student/login` with entry number + PIN slip → dashboard → Round 1 opens automatically when started → submitted screen → results when published → Round 2 page if a finalist.

### 0.5 Round 2 event format (migration 0007)
The final works the way the organizers described it:

| Rule | How it is implemented |
|---|---|
| **Top 15% go to Round 2** | Round 1 qualification % (default 15, Settings) → Results → compute → Round 2 → Finalists → "Use Round 1 qualifiers". Teams tied at the cut-off all qualify. |
| **One real-world problem per team, different problems** | Round 2 → Problems → **Import .docx** reads the problem pack in the browser (format: `Problem NN: Title`, `Category: … | Difficulty: …`, then sections **A** main statement, **B** parallel variant, **C** sample prompt, **D** expected solution; the evaluator checklist, rubric table and fairness rule become the shared jury criteria). Preview, then import; re-importing updates problems by number. Problem mode "Shared out from the active problems" gives each team one problem, balanced so teams get different problems while there are enough. |
| **Surprise twist from the admin panel** | Twist mode "Each team gets its own problem's twist": the **B. parallel variant** of each problem is that team's twist. Run the round → **Reveal twist** shows every team the variant of *its own* problem. Preflight refuses to start if an active problem has no twist, and reveal refuses (changing nothing) if any team's problem lacks one. |
| **20–30 minutes** | Default 25 minutes (Settings; any 5–240). |
| **Jury at the team's table, on a phone** | Judge signs in on a phone → Jury. Team picker at the top; tabs: *Problem & work* (problem, twist, final prompt and AI output, explanation, first attempt), *Ask & mark*, *Jury reference* (twist before it is revealed, sample prompt, expected solution, rubric — never sent to students), *Written Q&A* (optional questions to the team's screen). |
| **Questions: the jury's own or suggested by the system** | *Ask & mark* lists 8–12 suggested questions built from that team's problem figures, twist, prompts, output and explanation (free, no API call), plus an optional **AI suggestions** button (Gemini, rate-limited, uses the organizer's key). Tap a suggestion to use it, or type your own. |
| **Marks for 4–5 questions** | Jury mode "Marks per question": default **5 questions × 10 marks** (configurable 1–10 questions, 1–100 marks). Each mark is saved with its question text; a judge can save drafts and must mark every question to lock. Admins see every judge's questions and marks; the jury CSV export includes them. |
| **System marks + jury marks = result** | Round 2 = average jury total (out of 50) + system (AI) score scaled to 50 (on by default) = **out of 100**. Default final weights **Round 1 × 0 + Round 2 × 1**, so Round 2 decides the winners (configurable). Ties are broken by jury score, then system score, then Round 1 score; teams equal on all of these share a place. |
| **Declare the result** | Results → **Final & winners** shows a 1st/2nd/3rd podium. Publishing shows it on the projector (`/display`, "And the winners are…") and each team's results page ("Winner — 1st place"). Nothing is visible before publishing. |

No mechanism exists to pick or adjust winners other than the audited Round 2 score override (admin, with a reason, recorded in the audit log).

### 0.6 Projector screen and sign-in (organizer request, 2026-10-15)
- **The projector (`/display`) shows only what the whole hall may see:** the round name, a large animated countdown with a progress bar (calm → amber under 5 minutes → red pulse under 1 minute), paused/ended states, "The twist is live" during Round 2, rotating public announcements, and — only after final results are published — an animated winners reveal (3rd, 2nd, then 1st, with confetti). It no longer shows the room code or any registration/check-in/submission counts; `/api/display/stats` no longer returns them either. Animated background, live clock, cursor hidden until the mouse moves, a Full screen button. All motion is disabled for viewers with reduced-motion settings.
- **Room code removed.** Students sign in with **entry number + team PIN** only. The other protections stay: the entry must be checked in at the desk, one device per entry, 6 wrong PINs lock the entry for 10 minutes, per-IP limits. The code panel was removed from the desk and the `/api/access-code` endpoint deleted. `EVENT_SECRET` is no longer required.

### 0.7 Fixes from the first live use (2026-10-15, migration 0008)
- **"Could not clear participants" (HTTP 500) — root cause.** Supabase loads `pg-safeupdate` for API connections, which rejects any `UPDATE`/`DELETE` without a `WHERE` clause. Seven SQL functions used unfiltered statements (Delete all participants, Reset Competition Data, Round 2 start over, final results, clearing finalists, publishing final results). Locally they passed because the test database did not load `pg-safeupdate`. Second cause for the participants wipe: `admin_actions.entry_id` had no `ON DELETE` rule, so any audit row about a team blocked the delete.
  - Fix: 0008 re-creates those functions with explicit `where true` and makes the audit-log reference `ON DELETE SET NULL` (the audit rows are kept).
  - The local test setup now matches Supabase: API connections load `pg-safeupdate` (and the 8 s statement timeout), and every DB test calls functions with it switched on. A static scan of all 98 functions finds no unfiltered `UPDATE`/`DELETE`. New regression tests in `tests/db/safeupdate.test.ts`.
- **Team PINs now change every 60 seconds.** No more "Generate missing PINs" or printed slips. The Registration desk shows each team's current PIN (large in the check-in card, and a "PIN (live)" column), with a countdown. The PIN is derived on the server from `PIN_PEPPER` (if set) or `SESSION_SECRET` and the entry number; nothing is stored. The previous minute's PIN is still accepted for 30 seconds. Only volunteers and admins can see PINs (`GET /api/admin/team-codes`); students, judges and the projector cannot. Check-in, one device per team and the 6-failure lock are unchanged.
- **Two winners.** Results, the projector and the student results page declare 1st and 2nd place only.
- **"Before the event" list.** "PIN_PEPPER is not set" is gone (PINs no longer need it). "No entries are checked in" is shown as an event-day reminder instead of an error. The pool (93 CRW challenges approved, 11 CH/GK marked test, Common A = CRW-016, Common B = CRW-030) and the Round 2 settings were set on the live database on 2026-10-14 (audit log: `challenge_pool_setup`, `round2_config`).



---

## 1. Audit (phase 1): what was found

### What already worked
- Signed HttpOnly session cookies, with a constant-time signature check and a role whitelist.
- Per-route role checks.
- A server-side per-challenge timer.
- RLS on every table.
- The Gemini key stored AES-256-GCM encrypted.
- `tsc` and `next build` passed.

### Broken or incomplete (verified)
| # | Problem |
|---|---|
| B1 | AI evaluation never ran: no cron, no "Run evaluation" button, and qualification was never computed. |
| B2 | Stop lost work: drafts were never submitted or evaluated. |
| B3 | Pause did not pause time. |
| B4 | The round never auto-ended at its deadline. |
| B5 | Common challenges were "the first two rows Postgres returns", and test/demo challenges were active in production. |
| B6 | The login panel still showed `ENTRY-001` because of a regex bug. |
| B7 | Multi-word desk search never matched. |
| B8 | "Offline — changes saved locally" was false, and the last ~1.5 s of typing was lost at timer expiry. |
| B9 | Realtime on the display page never fired. |
| B10 | Logout only deleted the cookie, and the "online" panel was really login history. |
| B11 | No lint was configured, 4 production migrations were missing from the repo, and `tsconfig.tsbuildinfo` was committed. |

### Security (critical)
- Anyone on the internet could sign in as any student. The access code was public, entry numbers are sequential, and there was no rate limit.
- The evaluation cron route was publicly callable.

### Data integrity
Start, submit and evaluate were multi-request sequences without locks. Double-clicks and second tabs therefore caused:
- duplicate assignments;
- two submission refs for one entry;
- the same answer being evaluated (and billed) twice.

---

## 2. Feature summary

### Phase 1 (event-day hardening)
- **Server-side sessions** (`auth_sessions`) behind an HMAC-signed `__Host-` cookie. Revocation takes effect immediately on logout, password reset, account deletion, demotion, disqualification, device release and PIN re-issue.
- **Atomic SQL functions** for every state change: start, pause, resume, stop, autosave, advance, evaluation claiming, results, import and login. Only `service_role` can execute them.
- **Round lifecycle:** pause/resume shift deadlines exactly, Stop and auto-end finalise every answer, and late arrivals can be assigned while the round runs.
- **AI evaluation:** an exactly-once job queue with backoff and retries, schema-validated and injection-safe judging, and a results computation that handles overrides and ties.
- **CSV participant import:** merged cells, BOM/CRLF, wide sheets, idempotent re-import and sequential entry numbers.
- **Registration desk:** instant fuzzy search.
- **Live login activity:** online, idle and offline from heartbeats.

### Phase 2 (this update)
| Requirement | What was built |
|---|---|
| §1 Individual team PINs | A 6-digit PIN per entry. It is generated server-side, with weak patterns such as `123456` and `000000` excluded. It is shown **once** to the desk on printable slips, with an optional CSV download that is generated in the browser. The stored value is `scrypt(HMAC(pepper, PIN), salt)`, and the pepper lives only in the environment. The PIN is never returned by any API after issue, never logged, and never sent to the client again. Login = entry number + PIN (the rotating room code was removed on 2026-10-15). Re-issuing a PIN signs the team out everywhere. |
| §1 Rate limiting | Per entry: 6 failures per 10 minutes. Wrong PINs count, and the entry stays locked even if the right PIN is then given. Per IP: 600 requests per minute, which leaves headroom for a venue NAT. An unknown entry and a wrong PIN return an identical response. |
| §1 Organizer auth | Unchanged and separate: email + password, a separate role whitelist, and organizer sessions that can never act as a student and vice versa. |
| §2 Challenge pool | Upload `.xlsx`/`.csv`, review it as a **draft**, then publish. Search, filters, pagination of 50, bulk actions and an editor; delete asks for confirmation. Challenges referenced by past rounds are archived, never hard-deleted. |
| §2 Upload details | Every sheet is read, flexible headers are mapped, and row-level errors and warnings are reported. The preview shows new, changed, unchanged and missing-from-file rows. |
| §2 History and audit | Every assignment stores a snapshot of the challenge, so later edits never change what a team was given. Every pool change is audited with who and when. |
| §2 Locking while live | All pool writes are refused while a round is running or paused. |
| §3 Difficulty | Levels are Easy, Medium, Hard, Expert and Unrated (blank). Ratings are never invented. Assignment rules choose which difficulties and categories are eligible, optionally per slot, and enforce distinct categories. **Easy and Unrated are excluded by default.** Pool status (`approved` / `review` / `test` / `archived`) separates real questions from demo/test ones. |
| §3 Readiness gate | A preflight check shows the eligible counts and **blocks Start** when Common A/B are missing, the pool is too small or entries are invalid. It warns about thin pools and missing PINs. |
| §4 Reset | One admin-only **Reset Competition Data** action covers Round 1 and Round 2. You must type `RESET COMPETITION`. It is refused while any round is running or paused, runs as one transaction, and is audited. Registrations, PINs, attendance, the pool, accounts and settings are kept. See §6. The per-round "Start over" button was removed from the UI. |
| §5 Team size | Teams have 1 or 2 members, enforced in the database constraint, the CSV import, manual add, edit and assignment preflight. Each member keeps their own contact details. |
| Review fixes (Codex) | Entry-number allocation is serialised. The participant wipe is serialised with round start. Two admins can no longer delete each other at the same time and leave zero admins. |

---

## 3. Competition rules as implemented
- **Student sign-in.** Students enter their **entry number** (`7`; `07`, `#7` and `ENTRY-007` are also accepted) and their **team PIN**.
  - Only checked-in, non-disqualified entries that have a PIN can sign in.
  - One live device per entry: a device counts as live for 60 s after its last heartbeat, and the desk can release it.
- **Start.** Before Start, the server runs the readiness check (§5.4) and refuses to start if it fails. Assignment works like this:
  - Challenge 1 is Common A and challenge 2 is Common B.
  - Challenges 3 and 4 are drawn from the eligible pool for that slot. The least-used challenge is picked first, with a random tie-break. By default the two come from different categories, and neither may repeat a common.
  - Each assignment stores a snapshot of the challenge text and limits.
  - Late arrivals are handled with "Assign late arrivals".
- **Timers.** Each challenge timer (450 s, capped at the round end) starts when the student first opens that challenge.
  - "Next" unlocks only when the timer ends.
  - At expiry the client submits automatically, and the latest text is accepted up to 15 s late.
  - If a student is away, the server closes out their expired challenges on their next visit.
- **Pause / Resume.** Pause freezes every timer. Resume adds the exact paused time back to the round and to each in-progress challenge.
- **Stop.** Stop, or the round deadline passing, submits every outstanding answer as it is and queues it for evaluation.
- **Scoring.** Each challenge is scored 0–50 (five criteria of 0–10, with the total computed server-side). An entry's score is the sum of its four challenges (maximum 200). The latest manual override wins, and all ties at the qualification cutoff qualify.

---

## 4. Security audit

| # | Severity | Finding | Fix | Remaining risk |
|---|---|---|---|---|
| S1 | **Critical** | Anyone could sign in as any entry: the access code was public, entry numbers are sequential, and there was no rate limit. | Each entry now has its own **6-digit PIN** (hashed and peppered). The access code is organizer-only. Per-entry lock after 6 failures in 10 min; per-IP cap of 600/min; check-in required; one live device per entry. | A team that gives away its PIN slip gives away its login. The desk can re-issue the PIN, which signs everyone out. Guessing has a 1-in-a-million chance per try and is limited to 6 tries per 10 min per entry. |
| S1b | High | Brute-forcing PINs offline from a database dump. | The pepper (`PIN_PEPPER`, or a value derived from `SESSION_SECRET`) is never stored in the database, so a dump alone cannot be brute-forced. scrypt adds a per-PIN salt. | If both the database **and** the env secrets leak, the 10⁶ PIN space is quickly searchable. Re-issue all PINs in that case. |
| S2 | **Critical** | The cron route was publicly callable. | It is disabled unless `CRON_SECRET` is set, and the bearer token is checked in constant time. | — |
| S3 | High | Logout only cleared the cookie, so a stolen cookie stayed valid for 12 h. | Server-side sessions, revoked on logout, password reset, deletion, release, disqualification, role change and PIN re-issue. | A leaked `SESSION_SECRET` lets someone forge cookies, but a forged cookie still needs a live session row in the database. |
| S4 | High | Races: double start, double submit, double evaluation. | Row-locked SQL functions; `FOR UPDATE SKIP LOCKED` job claiming. | — (tested concurrently) |
| S5 | High | Destructive actions had no server-side guard. | Typed confirmations are checked on the server (`RESET COMPETITION`, `DELETE ALL PARTICIPANTS`, `DELETE`). Everything destructive is refused while a round is active and is audited. Reset, publish, participant wipe and start are serialised by locks. | An admin can still reset after the event, by design. |
| S6 | High | Two admins deleting each other at the same time left zero admins. | Delete takes a lock and re-checks that another admin remains (Codex P1). | — |
| S7 | Medium | Cross-team access (IDOR). | Every student write checks the session's own entry inside SQL. Challenge snapshots and submissions are only ever read through the session's entry. | — (tested) |
| S8 | Medium | No CSRF defence beyond SameSite=Lax. | Origin / Sec-Fetch-Site check on every mutating API request. | — |
| S9 | Medium | No security headers. | CSP, frame DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS and COOP. | CSP allows `'unsafe-inline'` scripts, which Next.js 14 needs without nonces. |
| S10 | Medium | Prompt injection into the AI judge. | Participant text is sent as JSON-encoded data; the output schema is enforced; the total is recomputed server-side. | LLM judging is never fully injection-proof. Admins can review and override scores. |
| S11 | Medium | Internal errors were leaked to clients. | Clients get generic messages; details go to server logs only. | — |
| S12 | Medium | Spreadsheet upload abuse. | The file is parsed in the browser, and the server **re-parses and re-validates** it. The request is limited to 6 MB, at most 30 sheets, 5000 rows and 10 000 characters per cell. Search input is stripped of PostgREST filter metacharacters (tested). | — |
| S13 | Low | Open redirect via `/\evil.com`. | `safeNextPath` | — |
| S14 | Low | Unlimited request bodies. | Size limits in middleware and per route; zod schemas. | — |
| S15 | Info | SQL injection. | Only the query builder and typed RPC parameters are used; there is no string-built SQL. | — |
| S16 | Info | Secrets. | The service key, PIN pepper, session secret and Gemini key are server-only (`server-only` guard). The browser bundle contains no Supabase key. | — |
| S17 | Info | `npm audit --omit=dev`: the same 11 issues as before this work (Next 14.2.35, whose fix requires Next 16, plus build-time tooling). `exceljs` was added with a pinned `uuid` override, so it adds none. | Accepted for the event. | Re-evaluate after the event. |

### Role / API matrix (enforced server-side; every row tested in `tests/api/authz.test.ts`)
| Endpoint | none | student | volunteer | judge | admin |
|---|---|---|---|---|---|
| `POST /api/student/login`, `POST /api/organizer/login` | public, rate-limited | | | | |
| `GET /api/display/stats` | 401 | 403 | ✓ | ✓ | ✓ |
| `GET /api/admin/participants`, `POST /api/admin/attendance`, `GET /api/admin/student-logins`, `POST /api/admin/sessions/release` | 401 | 403 | ✓ | 403 | ✓ |
| `POST /api/admin/pins` `{action:'reissue'}` (one entry) | 401 | 403 | ✓ | 403 | ✓ |
| `POST /api/admin/pins` `{action:'issue_missing'}` (bulk) | 401 | 403 | 403 | 403 | ✓ |
| `POST/DELETE /api/admin/participants`, `PATCH /api/admin/participants/:id`, `POST /api/admin/participants/import` | 401 | 403 | 403 | 403 | ✓ |
| `/api/admin/challenges` (GET/POST/PATCH/DELETE), `/api/admin/challenges/:id`, `/api/admin/challenges/rules`, `/api/admin/challenges/import`, `/api/admin/challenges/import/:batchId` | 401 | 403 | 403 | 403 | ✓ |
| `POST /api/admin/competition/reset`, `GET /api/admin/round1/preflight`, `/api/admin/round1/*` | 401 | 403 | 403 | 403 | ✓ |
| `/api/admin/evaluations`, `/api/admin/results`, `/api/admin/entries/:id/round1`, `/api/admin/users`, `/api/admin/ai-settings` | 401 | 403 | 403 | 403 | ✓ |
| `GET /api/admin/overview`, `GET/PUT /api/admin/round1/settings`, `GET /api/admin/competition/reset` (preview) | 401 | 403 | 403 | 403 | ✓ |
| `/api/admin/round2/*` (config, control, status, problems, twists, finalists, evaluations, review) | 401 | 403 | 403 | 403 | ✓ |
| `/api/admin/results/final`, `/api/admin/results/publication`, `/api/admin/announcements`, `GET /api/admin/export?type=…` | 401 | 403 | 403 | 403 | ✓ |
| `GET /api/jury/teams`, `GET /api/jury/teams/:entryId`, `POST /api/jury/questions` | 401 | 403 | 403 | ✓ | ✓ |
| `PUT /api/jury/scores` (a judge's own score) | 401 | 403 | 403 | ✓ | 403 (admins override instead) |
| `/api/student/round1/*`, `/api/student/round2/*`, `/api/student/dashboard`, `/api/student/results`, `/api/student/heartbeat`, `/api/student/waiting/state`, `/api/student/log` | 401 | ✓ (own entry only) | 403 | 403 | 403 |
| `GET /api/health` | public summary; details only for an admin session | | | | |
| `GET /api/cron/process-evaluations` | bearer `CRON_SECRET` only | | | | |

Every protected endpoint was also tested with four bad sessions, and each returns 401:
- an **expired** session;
- a **tampered** one (role edited);
- one with an **invalid role**;
- a **revoked** one (validly signed, but with no live database row).

PIN-specific tests:
- **Guessed PINs:** the response is identical to an unknown entry.
- **Repeated failures:** after 6 failures, even the right PIN gets 429. Other entries are unaffected.
- **Re-issue:** the old session gets 401 and the old PIN stops working.
- **Exposure:** the PIN and its hash never appear in participant listings.
- **Volunteers:** cannot bulk-generate PINs, reset, edit entries or touch the pool.
- **Cross-team access:** student A against student B's submission gets 403.
- **Tampered and revoked cookies:** 401.

Round 2 / results tests (`tests/api/round2-results.test.ts`, `tests/db/round2.test.ts`):
- Students never receive Round 2 expected output or judging criteria; the jury does.
- A non-finalist gets `eligible: false` and 403 on save; a team cannot answer another team's jury question (404).
- Results are invisible until published and then follow each visibility switch; volunteers and judges cannot publish (403).
- Targeted announcements reach only their audience; the projector never shows targeted messages.
- Exports are admin-only and contain no PINs or PIN hashes; unknown export types are rejected.

---

## 5. Challenge pool

### 5.1 File format and column mapping
Upload `.xlsx` or `.csv`. **Every sheet is read.** In each sheet, the header row is found automatically by scanning the first 15 rows. Sheets with no recognisable header are skipped, and the preview says why (for example the `Task` sheet in your workbook). Headers are compared case-insensitively, ignoring spaces, punctuation and trailing `:`. You can override the mapping, and exclude sheets, in the upload screen.

| Field | Required | Recognised headers (examples) | Notes |
|---|---|---|---|
| PS ID / challenge code | **yes** | `PS ID:`, `PS No`, `ID`, `Challenge ID`, `Code`, `Question ID`, `Task ID` | Spaces are removed and the code is upper-cased (`crw 001` → `CRW001`). It is the key used to match rows on re-upload. A duplicate inside the file is an error on the later row, which is then skipped. |
| Problem statement | **yes** | `Challenge Prompt:`, `Problem Statement`, `Prompt`, `Question`, `Task`, `Description` | Shown to the student. |
| Title | no | `Title`, `Challenge Title`, `Name` | If missing: `"<Category> · <PS ID>"`. |
| Category | no | `Category:`, `Type`, `Topic`, `Domain` | Case variants are unified to the most common spelling (`data analysis` / `Data Analysis`). |
| Difficulty | no | `Difficulty:`, `Level`, `Complexity` | `Easy/E/Beginner` → easy; `Medium/Mid/Moderate` → medium; `Hard/Difficult/Advanced` → hard; `Expert/Very hard` → expert. Blank or unknown → **unrated** (with a warning). Ratings are never guessed. |
| Expected output | no | `Expected Output:`, `Sample Output`, `Answer` | Given to the AI judge, not to students. |
| Evaluation criteria | no | `Evaluation Criteria:`, `Rubric`, `Marking Scheme` | Given to the AI judge. |
| Instructions / Constraints | no | `Instructions`, `Notes` / `Constraints`, `Rules` | Shown to the student. |
| Prompt word limit / Output char limit | no | `Word Limit`, `Max Words` / `Char Limit`, `Max Characters` | If blank, the publish defaults apply (150 words / 2000 characters unless you change them). |

Your workbook (`Prompt_Engineering_Battle___Round_1_Task_Allocation.xlsx`) parses as follows:
- **600 data rows** on 6 author sheets; the `Task` sheet is skipped.
- **599 importable** rows, plus 1 duplicate (`CRW-034` appears twice, and the second is rejected).
- Difficulty counts: easy 153, medium 220, hard 214, expert 7, unrated 5.
- 25 categories after case unification.
- 85 warnings, mostly blank optional fields and the 5 unrated rows.

### 5.2 Uploading a refined file and publishing it
1. Go to **Admin → Challenge pool → Import / update file** and choose the file.
2. Check the sheet list and column mapping, and adjust them if needed. The preview re-runs on the server.
3. Read the **preview**. Nothing is live yet.
   - It shows the counts of **new**, **changed** (with which fields changed), **unchanged**, **errors** (rows that will be skipped) and **missing from file** (live challenges whose ID is not in this file).
   - It also shows the difficulty and category counts.
4. Choose how to publish:
   - **Merge** (recommended for a refined file): new IDs are added, changed IDs are updated in place (same ID, so history is preserved), and IDs missing from the file are left alone.
   - **Replace**: as Merge, but challenges missing from the file are **archived** (never deleted) and their common slot is cleared. Challenges marked `test` are left alone.
   - **Status of new rows**: `approved` (eligible immediately) or `review` (kept out of the event until you approve them on the Pool tab).
   - **Default limits** for rows without limits: 150 words and 2000 characters.
5. Tick the acknowledgement and click **Publish**. A draft can be published only once. Uploading the same file again produces "0 new / 0 changed" (tested with your file: 599 unchanged).
6. Publishing is **refused while a round is running or paused**. Assignments that were already made keep their snapshot even if you edit or archive the challenge later.

The History tab lists every upload (who, when, file name, status) and every pool change (`challenge_*` audit entries).

### 5.3 Selecting Common A/B and excluding Easy
1. Go to **Challenge pool → Common A/B & rules**.
2. **Common A** and **Common B**: type a PS ID or a few words and pick from the list. Only **active + approved** challenges can be chosen. Choosing an Easy challenge as a common is allowed, because you choose commons explicitly, but the readiness check warns you.
3. **Allowed difficulties for challenges 3–4**: the default is Medium, Hard and Expert, which **excludes Easy and Unrated**. Optionally set different difficulties per slot (for example slot 3 = Medium, slot 4 = Hard or Expert).
4. **Allowed categories**: all by default, or restrict them.
5. **Distinct categories**: on by default, so slots 3 and 4 come from different categories.
6. To keep demo or test rows out entirely, select them on the Pool tab and use **Mark test** (or **Disable**). Only `approved` + active challenges are ever assigned.

### 5.4 Readiness check (preflight)
It is shown on the dashboard (refreshed every 15 s before the start) and on the rules tab.

**Start is blocked when:**
- Common A or B is missing, inactive or not approved;
- slot 3 or slot 4 has no eligible challenge, or fewer than two different eligible challenges exist for slots 3–4;
- a checked-in entry has 0 or more than 2 members;
- no entries are checked in.

**It warns, without blocking, when:**
- checked-in entries have no PIN;
- a common is rated Easy or Unrated;
- the eligible pool is small enough that each challenge will be reused many times across teams.

---

## 6. Reset Competition Data: exact behaviour
**Who:** admins only. Volunteers and judges get 403.
**Where:** Settings & health → "Reset competition data". A preview lists the exact counts that will be deleted and kept; then you must type `RESET COMPETITION`. (Each round also has its own **Start over**, typed `START OVER`; Round 1's is refused once Round 2 has started.)

**Refused when:** Round 1 or Round 2 is `running` or `paused` (HTTP 409). Stop the round first.

**Deleted**, in one transaction, in foreign-key order. Counts are returned to you and written to the audit log.
- Round 1: challenge assignments, which cascade to submissions, submission versions, evaluation jobs, AI evaluations and human review overrides; plus round results.
- Round 2: finalists, round 2 assignments and states, judge questions, judge scores, round 2 AI evaluations and jobs, round 2 score overrides, and final results.
- Results publication: both Round 1 and final results are un-published.
- Activity logs of in-round events only: `submission`, `tab_hidden`, `tab_visible`, `window_blur` and `paste_blocked`.
- All announcements.

**Then:** Round 1 and Round 2 are both set to `not_started`, with start, end and pause times cleared.

**Kept:**
- entries, members, entry numbers, PINs, attendance (check-in) and disqualification flags;
- the whole challenge pool and its import history, Common A/B and assignment rules;
- Round 2 problems, surprise twists and Round 2 settings;
- organizer, judge and admin accounts, event settings, the Gemini key and round configuration (timers);
- the audit log and login/session history.

Students stay signed in and return to the waiting room.

**Concurrency:**
- Reset holds the `competition_reset` and `challenge_pool` locks and locks both round rows, so a Start, pause, pool publish or another reset either waits for it or sees the new state.
- A student request that is in flight either finishes before the reset, or fails cleanly after it (its submission no longer exists).
- An evaluation batch that is in flight cannot recreate deleted rows. In the load test (§8), a batch evaluating 20 answers was running when reset hit; all evaluation rows were 0 afterwards.

**Repeatable:** a reset on already-reset data succeeds, with zero counts.

---

## 7. Environment variables (names only; no values are in the repo)
| Name | Required | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | yes | Server-only database access (service role). |
| `SESSION_SECRET` | yes, at least 32 random characters | Signs session cookies. It also derives the Gemini-key encryption key and, if `PIN_PEPPER` is unset, the PIN pepper. Rotating it signs everyone out and invalidates **all PINs** when no `PIN_PEPPER` is set. |
| `EVENT_SECRET` | no | No longer used (the room code was removed). Safe to leave set. |
| `PIN_PEPPER` | **recommended**, at least 32 random characters | **New.** A dedicated PIN pepper, so `SESSION_SECRET` can be rotated without invalidating PINs. Set it **before** issuing PINs; changing it later means re-issuing every PIN. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_CONCURRENCY` | optional | The key can be set in Admin → AI Judging instead. |
| `CRON_SECRET` | optional | Enables the scheduled evaluation worker route. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | no longer used | Can be removed. |

---

## 8. Test results

**All results are from a local staging stack**, not from Vercel or Supabase:
- Postgres 16 → PostgREST 12.2.3 → `next start`, a mock Gemini server and k6, all on one machine with **2 vCPU and 7 GB**.
- Synthetic data only.
- **No 200-user test has been run against Vercel + Supabase.** There is no free separate staging database (§9.2); the numbers below are an upper bound for a 2-CPU box, not a production measurement.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ 0 errors. No `any` casts or ignore directives were added. |
| Lint | `npx next lint` | ✅ no warnings |
| Production build | `npx next build` | ✅ all routes compiled (phase 3 adds 25 API routes and 6 pages), middleware 26.8 kB |
| Unit tests | `npm test` | ✅ 34 passed (8 new in 0007: .docx pack parsing incl. a decompression-size cap and malformed files, suggested jury questions, AI-suggestion validation). 1 is skipped unless `PEB_PS_WORKBOOK` is set. The real Round 2 pack was also parsed locally (25/25 problems with all four sections); it is **not** committed, because the repository is public and the pack contains the evaluator guide. |
| Database function tests | `PGHOST=/tmp PGPORT=54329 npm run test:db` | ✅ **62/62** (8 new for 0007: defaults, pack import, per-problem twist and preflight, jury question mode, tie-break, old-config compatibility, privileges). One earlier run had 2 failures in `pool-reset` (PIN issuance / entry editing) that did not reproduce in 3 later runs, alone or in the full suite; treat as a possible flaky test. |
| HTTP tests (local stack) | `tests/api/run.sh` | ✅ **34/34** (87 endpoint rows in the authorization matrix; 4 new for the Round 2 event format: pack import, one problem per team + own twist, jury marks per question with suggestions, winners on projector/results), plus the real-workbook test (skipped unless `PEB_PS_WORKBOOK` is set). Re-runnable: consecutive runs pass. |
| Migration up → down → up | `tests/db/rollback.sh` | ✅ 0007, 0006, 0005 and 0004 roll back cleanly with data kept, and re-apply cleanly (`app_schema_status` = v7, nothing missing). |
| Upgrade of a production-shaped DB | 0001–0003 + sample data, then 0004 → 0007 | ✅ applies without errors; entry numbers back-filled; existing challenges become `review`; old public announcement still visible; an existing Round 2 problem is kept (no twist yet); schema v7 complete. |
| Login 500 reproduction | production-shaped DB behind PostgREST | ✅ raw call gives `PGRST202` (the cause); the app now returns 503 `setup_required` + a sign-in banner; the same login against the migrated DB returns 200. |
| Round 2 event flow in a browser | Playwright + Chromium, local production build | ✅ admin imports the real .docx through the UI (25 problems, all with twist), saves the default settings, 4 finalists get 4 different problems, reveal gives each its own variant (student phone view checked), judge on a 390 px phone uses suggested + own questions and marks, AI suggestions (mock Gemini), compute → podium on admin, projector and the winning team's phone. |
| Browser walk-through | Playwright + Chromium, local production build, desktop 1440 px and phone 390 px | ✅ 40+ screenshots (student login, dashboard, Round 1 arena, Round 2 stages, results; organizer overview, rounds, jury, results, announcements, settings, desk, pool, projector) render without page errors or CSP violations. Visual issues found this way were fixed and re-checked (toggle switch, phone header, PIN placeholder spacing); the Round 2 stage bar fix for phones was not re-screenshotted. |
| Real workbook (600 PS) over HTTP | `PEB_PS_WORKBOOK=… node --test tests/api/real-workbook.test.ts` | ✅ payload 293 KB · preview 84–115 ms · publish 599 rows ~30 ms · re-upload = 599 unchanged · list/search/filter 48–94 ms |
| `npm audit --omit=dev` | | 11 issues, all present before this work (see S17) |

What the database tests cover:
- the round lifecycle, assignment balance, timers, pause/resume, stop/auto-end and results;
- login rules, PINs and the 6-failure lock;
- session revocation and exclusive job claiming;
- browser roles denied;
- the 0004 upgrade on legacy data;
- preflight, per-slot rules and distinct categories;
- snapshots preserving history and publish blocked while active;
- reset (scope, refusal, phrase, serialisation with start, repeatability);
- the participant wipe vs start race, and concurrent admin deletion;
- PIN issue and re-issue, and entry edit (1–2 members, no copied contacts);
- publish merge, replace, review, idempotency and refined updates.

What the HTTP tests cover:
- all endpoints × {none, expired, tampered, invalid role, revoked} → 401; the role matrix; IDOR; CSRF; logout replay;
- login rate limits and uniform errors; open redirect; page guards; headers; body limits; cron closed;
- PIN issue, show-once and never-listed; guessed and repeated PINs; re-issue revocation;
- volunteer limits; team size; pool upload → draft → publish → refined update → search; the common/approved rule;
- Easy exclusion changing eligible counts; reset over HTTP;
- the full event journey: import → check-in → PIN → login → device release → start → autosave → pause/resume → advance ×4 → stop → AI evaluation → results → logout.

### Load test: 200 concurrent students (k6, local stack, 2 vCPU, phase 3 run)
Runner: `tests/load/run-local.sh`. Every service and the load generator share the same 2 CPUs.

| Scenario | Volume | p50 | p95 | max | Errors | Target | Result |
|---|---|---|---|---|---|---|---|
| 200 simultaneous logins (entry + PIN + code) | 200 | 2.70 s | **3.24 s** | 3.29 s | 0 | p95 < 2 s | ❌ on this box (phase 2 run: 2.48 s), see note |
| **Waiting room**: 200 teams polling their dashboard every ~4 s for 90 s (new) | 7,424 req | 5 ms | 12 ms | 216 ms | 0 | p95 < 800 ms | ✅ |
| 200 students active for 4 min (autosave ~5 s, polling, heartbeat) | 27,365 req, ~100 req/s | 9 ms | 70 ms | 3.4 s | 6 (0.02%) | p95 < 800 ms, < 0.5% | ✅ |
| — autosave only | 10,741 | 7 ms | 31 ms | 1.0 s | 6 | p95 < 800 ms | ✅ |
| Admin dashboard during load | 2 VUs | 21 ms | 64 ms | 1.2 s | 0 | p95 < 1.5 s | ✅ |
| Registration desk during load | 3 VUs | 15 ms | 591 ms | 2.7 s | 0 | p95 < 1.5 s | ✅ |
| **Timer-expiry storm** (all 200 timers expire together, 2 advance calls each) | 400 | 477 ms | **2.86 s** | 3.0 s | 0 | p95 < 2.5 s | ❌ on this box, see note |
| AI evaluation, 880 answers (400 non-empty), mock Gemini with ~7% injected 429/500 | 433 model calls | — | — | 209 s wall | 0 failed | each answer exactly once | ✅ 400 OK + 33 injected errors retried; 480 empty answers scored 0 without a call |
| **Reset while an evaluation batch is in flight** | 1 reset | — | — | — | — | nothing resurrected; both rounds `not_started`; data kept | ✅ 0 assignments, submissions, jobs and evaluations afterwards; 230 entries, 228 PINs, 220 check-ins and 42 challenges kept |

**Integrity after the storm:** exactly 200 challenges locked (one per entry), 0 duplicate submission refs, 0 duplicate evaluation jobs, 0 entries with more than one live session, 0 unexpected 409s.

**Notes**
- **Login latency.** Login now does a PIN hash check (scrypt, ~10 ms CPU, reduced from ~45 ms in this update with no security loss, because the pepper is the real protection) plus one extra database round trip. With 200 logins in the same second on 2 shared CPUs (k6, Node, PostgREST and Postgres all competing), that queues up to about 2.5–3.2 s; the run-to-run spread on this box is large.
  - On Vercel, logins are spread across function instances.
  - In practice teams arrive over minutes, not within one second.
  - This is still the number to re-measure on real infrastructure.
- **Storm.** This is app-tier CPU contention on the 2-vCPU box. Measured directly in the database in phase 1, 400 concurrent advance calls finished in 265 ms in total. Real timers are also staggered, because each one starts when the student opens the challenge.
- **The 6 errors** were TCP keep-alive resets between k6 and a single `next start` process. They are specific to self-hosted Node, and the student page retries autosave and keeps a local copy.

---

## 9. Staging migration, production deployment and rollback

### 9.1 Migrations in this PR
| File | What it does | Safe with the currently deployed code? |
|---|---|---|
| `0003_reconcile_production_schema.sql` | Brings 4 production-only migrations into the repo. It is a no-op on production. | Yes |
| `0004_event_readiness.sql` | Entry numbers (with a trigger, so old inserts still work), per-member fields, a team-size constraint of **1–2** (it **fails if any existing entry has 3+ members**; a read-only check of production on 2026-10-13 found 10 entries, all with at most 2 members, 104 challenges rated easy/medium/hard, both rounds `not_started`, and none of 0003–0005 applied), common slots, sessions, rate limits and all the round functions. | Yes, additive. Old code keeps working. |
| `0005_pins_pool_reset.sql` | PIN columns, pool status, difficulty `expert`/`unrated`, import batches, assignment snapshots, assignment rules, preflight, the new login/PIN/publish/reset/edit functions. **Existing challenges become `review`**, so nothing is assigned until you approve the pool. | Yes for the schema. The old app's assignment code ignores `pool_status`. |
| `0006_round2_results_comms.sql` | Round 2 settings/finalists/jury/AI queue/overrides, final results, results publication settings, announcement targeting (the public read policy now only exposes `audience = 'all'`), student dashboard/results functions, reset preview, `app_schema_status()`, and an extended `competition_reset`. | Yes, additive. New columns have defaults; existing function signatures are unchanged. |
| `0007_round2_pack_jury_questions.sql` | Round 2 problem pack fields (category, difficulty, per-problem twist, jury-only sample prompt), twist mode `problem`, jury mode `questions` (per-question marks with question text), event defaults (25 min, shared-out problems, own twist, 5 × 10 jury, AI 50, weights 0/1), tie-break, `round2_import_problems()`, `app_schema_status()` v7. | Yes, additive. Configurations saved before 0007 keep working (missing jury mode = criteria). |

### 9.2 Staging (₹0 budget)
There is no separate staging database: both free Supabase project slots are in use, and Supabase branches are billed, so neither was created. Instead:
- Every migration, the full HTTP suite and the k6 load tests run against a **local staging stack** that mirrors Supabase (Postgres 16 + PostgREST + the same migrations) with synthetic data (`tests/stack/start.sh`, `tests/api/run.sh`, `tests/load/run-local.sh`).
- Migrations were also applied to a **production-shaped copy** (only 0001–0003, like production today) to confirm they upgrade it cleanly and to reproduce the login 500.
- `tests/db/rollback.sh` proves `0007 → 0006 → 0005 → 0004` roll back and re-apply cleanly.
- Vercel Preview uses the production database. Because 0003–0007 are additive and safe with the currently deployed `main`, applying them to that database is what unblocks the preview — but it is a change to the production database, so it needs your go-ahead (§9.3 step 3).

### 9.3 Production (each step needs your explicit go-ahead)
1. Take a backup: Supabase dashboard → Database → Backups, or `pg_dump`.
2. Set `PIN_PEPPER` (Production scope) in Vercel.
3. Apply `0003`, `0004`, `0005`, `0006` and `0007` to production, in that order and one at a time, checking for errors after each. Then open `/api/health` (signed in as admin): it must say `database: ok, schemaVersion: 7`. Sign-in then works.
4. Test the preview end to end (§0.4) with a test entry. Then merge PR #4 into `main`, which triggers the Vercel production deploy. **Everyone must sign in again**, because the cookie format changed.
5. Admin → Challenge pool → Import: upload the final workbook, then **Merge** + **approved**. Then mark `CH-*` / `GK-*` as **test**, choose Common A/B and confirm the rules (Easy excluded).
6. Registration desk → **Generate missing PINs**, then print the slips (or download the CSV) and store them securely.
7. Smoke test with one test entry: check in, log in with its PIN, Start, answer, Stop, Run evaluation. Then **Reset Competition Data** and delete the test entry.
8. Confirm that the Overview's "Before the event" list is empty (or only has items you accept).
9. Round 2: Problems → Import .docx (the problem pack), review and save Round 2 settings, and create judge accounts (Accounts) before the event day.

### 9.4 Rollback
- **App rollback (preferred, no data loss):** promote the previous production deployment in Vercel. 0004–0007 are additive, and the old app runs against them. Users must sign in again.
- **Database rollback (only if really needed):** `supabase/rollback/0007_down.sql`, then `0006_down.sql`, then `0005_down.sql`, then `0004_down.sql` (stop at the version you want).
  - These **drop** PIN hashes, pool status, import history, assignment snapshots, rules, sessions and entry numbers. They keep participants, members, challenges and submissions.
  - `0007_down` restores the 0006 Round 2 functions and drops per-problem twists, pack metadata and per-question jury marks (judge totals are kept).
  - `0006_down` drops Round 2 finalists/jobs/overrides, announcement targeting and publication settings, and restores the 0005 `competition_reset`.
  - Re-applying `0004`–`0007` afterwards works; this was tested locally (`tests/db/rollback.sh`).
  - Take a backup first.

---

## 10. Known risks and limitations
- **No deployment of this code can sign anyone in until migrations 0003–0007 are applied** to the database it uses (the production database). The app now says so clearly (503 + banner + `/api/health`) instead of a 500.
- **Not tested on Vercel + Supabase at 200 users.** The local numbers are an upper bound for 2 vCPU, not a production measurement. Login burst (p95 3.2 s) and the timer-expiry storm (p95 2.9 s) missed their targets on the local box; everything else passed with large margins.
- **Gemini quota.** About 800 Round 1 evaluations (+1 per finalist in Round 2 if AI scoring is on). On the free tier (~10 requests/min for 2.5 Flash) that is about 80 minutes; failures can be retried.
- **PIN distribution is a physical process.** Slips are shown once. A lost slip means re-issuing the PIN at the desk.
- **Round 2 rules are yours to confirm.** The settings screen starts from your described format (25 min, one problem per team, own twist, 5 questions × 10 jury marks, AI 50, Round 2 decides the winners); Round 2 refuses to start until an admin saves them.
- **System (AI) score needs Gemini.** With AI on, final results wait until every Round 2 evaluation has finished (or "compute anyway"). If the Gemini key or quota fails on the day, turn the AI score off before Round 2 starts so the jury alone decides.
- **Suggested questions are prompts for the jury, not a script.** Built-in suggestions are template-based; "AI suggestions" uses one Gemini call per tap (limited to 12 per judge per 10 minutes).
- **Round 1 rubric** (five criteria × 10 per challenge) is fixed in code; per-challenge limits and qualification % are configurable.
- **Difficulty data in the workbook:** 5 rows are unrated and 1 has a blank category. They are excluded from slots 3–4 until rated.

## 11. Decisions and data still needed from you
1. **Approval to apply migrations 0003 → 0007 to the Supabase project** (the one Production and Preview share). This is the only thing blocking sign-in on the preview. All four are additive and safe with the current `main`; take a backup first (§9.3).
2. **Set `PIN_PEPPER`** in Vercel (Production + Preview, different values) before PINs are issued.
3. **Round 2:** import the problem pack and save the settings (defaults follow your format). Confirm whether Round 1 should count at all in the final (default: no, Round 2 alone decides).
4. ~~Keep the room access code?~~ Decided: removed (sign-in = entry number + PIN; check-in still required).
5. **Which PS IDs are Common A and Common B?** Mark `CH-*` / `GK-001…005` as test? (Recommended.)
6. **Workbook fixes:** the `CRW-034` duplicate ID, the 5 unrated rows and the 1 blank-category row.
7. **Event date**, so the deployment timeline can be planned.
