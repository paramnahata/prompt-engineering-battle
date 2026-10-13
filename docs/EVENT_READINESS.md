# Event-readiness report — Prompt Engineering Battle (SWAYAMBHU 2026)

Branch `hardening/event-readiness` (PR #4), based on `main` @ `0e37ab2` (production deployment of that commit was **READY** on Vercel when this work started).

Everything below was verified by running code; the commands and outputs are in §8. Anything that was **not** verified is marked as such.

**Nothing has been applied to production.** Migrations 0003, 0004 and 0005 are unapplied. `main` is unchanged. No live setting or production data was modified. Production was only read, for schema compatibility checks in phase 1.

Contents:
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
| §1 Individual team PINs | A 6-digit PIN per entry. It is generated server-side, with weak patterns such as `123456` and `000000` excluded. It is shown **once** to the desk on printable slips, with an optional CSV download that is generated in the browser. The stored value is `scrypt(HMAC(pepper, PIN), salt)`, and the pepper lives only in the environment. The PIN is never returned by any API after issue, never logged, and never sent to the client again. Login = entry number + PIN + the rotating room access code. Re-issuing a PIN signs the team out everywhere. |
| §1 Rate limiting | Per entry: 6 failures per 10 minutes. A wrong PIN and a wrong access code both count, and the entry stays locked even if the right PIN is then given. Per IP: 600 requests per minute, which leaves headroom for a venue NAT. An unknown entry and a wrong PIN return an identical response. |
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
- **Student sign-in.** Students enter their **entry number** (`7`; `07`, `#7` and `ENTRY-007` are also accepted), their **team PIN** and the 4-digit **room access code** shown on the projector.
  - The access code is valid for 2 minutes, plus a 20-second grace period after it rotates.
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
| `GET /api/access-code`, `GET /api/display/stats` | 401 | 403 | ✓ | ✓ | ✓ |
| `GET /api/admin/participants`, `POST /api/admin/attendance`, `GET /api/admin/student-logins`, `POST /api/admin/sessions/release` | 401 | 403 | ✓ | 403 | ✓ |
| `POST /api/admin/pins` `{action:'reissue'}` (one entry) | 401 | 403 | ✓ | 403 | ✓ |
| `POST /api/admin/pins` `{action:'issue_missing'}` (bulk) | 401 | 403 | 403 | 403 | ✓ |
| `POST/DELETE /api/admin/participants`, `PATCH /api/admin/participants/:id`, `POST /api/admin/participants/import` | 401 | 403 | 403 | 403 | ✓ |
| `/api/admin/challenges` (GET/POST/PATCH/DELETE), `/api/admin/challenges/:id`, `/api/admin/challenges/rules`, `/api/admin/challenges/import`, `/api/admin/challenges/import/:batchId` | 401 | 403 | 403 | 403 | ✓ |
| `POST /api/admin/competition/reset`, `GET /api/admin/round1/preflight`, `/api/admin/round1/*` | 401 | 403 | 403 | 403 | ✓ |
| `/api/admin/evaluations`, `/api/admin/results`, `/api/admin/entries/:id/round1`, `/api/admin/users`, `/api/admin/ai-settings` | 401 | 403 | 403 | 403 | ✓ |
| `/api/student/round1/*`, `/api/student/heartbeat`, `/api/student/waiting/state`, `/api/student/log` | 401 | ✓ (own entry only) | 403 | 403 | 403 |
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
**Where:** Admin dashboard → "Reset Competition Data". You must type `RESET COMPETITION`.

**Refused when:** Round 1 or Round 2 is `running` or `paused` (HTTP 409). Stop the round first.

**Deleted**, in one transaction, in foreign-key order. Counts are returned to you and written to the audit log.
- Round 1: challenge assignments, which cascade to submissions, submission versions, evaluation jobs, AI evaluations and human review overrides; plus round results.
- Round 2: round 2 assignments and states, judge questions, judge scores, round 2 AI evaluations, and final results.
- Activity logs of in-round events only: `submission`, `tab_hidden`, `tab_visible`, `window_blur` and `paste_blocked`.
- All announcements.

**Then:** Round 1 and Round 2 are both set to `not_started`, with start, end and pause times cleared.

**Kept:**
- entries, members, entry numbers, PINs, attendance (check-in) and disqualification flags;
- the whole challenge pool and its import history, Common A/B and assignment rules;
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
| `EVENT_SECRET` | yes | Derives the rotating 4-digit room access code. |
| `PIN_PEPPER` | **recommended**, at least 32 random characters | **New.** A dedicated PIN pepper, so `SESSION_SECRET` can be rotated without invalidating PINs. Set it **before** issuing PINs; changing it later means re-issuing every PIN. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_CONCURRENCY` | optional | The key can be set in Admin → AI Judging instead. |
| `CRON_SECRET` | optional | Enables the scheduled evaluation worker route. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | no longer used | Can be removed. |

---

## 8. Test results

**All results are from a local staging stack**, not from Vercel or Supabase:
- Postgres 16 → PostgREST 12.2.3 → `next start`, a mock Gemini server and k6, all on one machine with **2 vCPU and 7 GB**.
- Synthetic data only.
- **No 200-user test has been run against Vercel + Supabase.** That needs a separate staging Supabase project or branch (§11).

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ 0 errors. No `any` casts or ignore directives were added. |
| Lint | `npx next lint` | ✅ no warnings |
| Production build | `npx next build` | ✅ 53 routes, middleware 26.8 kB |
| Unit tests | `npm test` | ✅ 23 passed. 1 is skipped unless `PEB_PS_WORKBOOK` is set; with your workbook it passes (4/4 in that file). |
| Database function tests | `PGHOST=/tmp PGPORT=54329 npm run test:db` | ✅ **40/40** |
| HTTP tests (local stack) | `tests/api/run.sh` | ✅ **22/22**, plus the real-workbook test (skipped unless `PEB_PS_WORKBOOK` is set; passes with your file). The suite is re-runnable on the same staging DB, verified with two consecutive runs. |
| Migration up → down → up | `tests/db/rollback.sh` | ✅ 0005 and 0004 roll back cleanly with data kept (entries survive), and re-apply cleanly. |
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

### Load test: 200 concurrent students (k6, local stack, 2 vCPU, phase 2 run with PINs)
Runner: `tests/load/run-local.sh`. Every service and the load generator share the same 2 CPUs.

| Scenario | Volume | p50 | p95 | max | Errors | Target | Result |
|---|---|---|---|---|---|---|---|
| 200 simultaneous logins (entry + **PIN** + code) | 200 | 1.74 s | **2.48 s** | 2.54 s | 0 | p95 < 2 s | ❌ on this box (phase 1 without PIN: 1.23 s), see note |
| 200 students active for 4 min (autosave ~5 s, polling, heartbeat) | 27,293 req, ~99 req/s | 10 ms | 89 ms | 4.0 s | 4 (0.01%) | p95 < 800 ms, < 0.5% | ✅ |
| — autosave only | 10,709 | 8 ms | 36 ms | 1.4 s | 4 | p95 < 800 ms | ✅ |
| Admin dashboard during load | 2 VUs | 24 ms | 95 ms | 1.9 s | 0 | p95 < 1.5 s | ✅ |
| Registration desk during load | 3 VUs | 21 ms | 128 ms | 3.6 s | 0 | p95 < 1.5 s | ✅ |
| **Timer-expiry storm** (all 200 timers expire together, 2 advance calls each) | 400 | 561 ms | **3.65 s** | 4.0 s | 0 | p95 < 2.5 s | ❌ on this box, see note |
| AI evaluation, 884 answers (400 non-empty), mock Gemini with ~7% injected 429/500 | 428 model calls | — | — | 296 s wall | 0 failed | each answer exactly once | ✅ 400 OK + 28 injected errors retried; 484 empty answers scored 0 without a call |
| **Reset while an evaluation batch is in flight** | 1 reset | — | — | — | — | nothing resurrected; both rounds `not_started`; data kept | ✅ 0 assignments, submissions, jobs and evaluations afterwards; 231 entries, 230 PINs, 221 check-ins and 641 challenges kept |

**Integrity after the storm:** exactly 200 challenges locked (one per entry), 0 duplicate submission refs, 0 duplicate evaluation jobs, 0 entries with more than one live session, 0 unexpected 409s.

**Notes**
- **Login latency.** Login now does a PIN hash check (scrypt, ~10 ms CPU, reduced from ~45 ms in this update with no security loss, because the pepper is the real protection) plus one extra database round trip. With 200 logins in the same second on 2 shared CPUs, that queues up to about 2.5 s.
  - On Vercel, logins are spread across function instances.
  - In practice teams arrive over minutes, not within one second.
  - This is still the number to re-measure on real infrastructure.
- **Storm.** This is app-tier CPU contention on the 2-vCPU box. Measured directly in the database in phase 1, 400 concurrent advance calls finished in 265 ms in total. Real timers are also staggered, because each one starts when the student opens the challenge.
- **The 4 errors** were TCP keep-alive resets between k6 and a single `next start` process. They are specific to self-hosted Node, and the student page retries autosave and keeps a local copy.

---

## 9. Staging migration, production deployment and rollback

### 9.1 Migrations in this PR
| File | What it does | Safe with the currently deployed code? |
|---|---|---|
| `0003_reconcile_production_schema.sql` | Brings 4 production-only migrations into the repo. It is a no-op on production. | Yes |
| `0004_event_readiness.sql` | Entry numbers (with a trigger, so old inserts still work), per-member fields, a team-size constraint of **1–2** (it **fails if any existing entry has 3+ members**; a read-only check of production on 2026-10-13 found 10 entries, all with at most 2 members, 104 challenges rated easy/medium/hard, both rounds `not_started`, and none of 0003–0005 applied), common slots, sessions, rate limits and all the round functions. | Yes, additive. Old code keeps working. |
| `0005_pins_pool_reset.sql` | PIN columns, pool status, difficulty `expert`/`unrated`, import batches, assignment snapshots, assignment rules, preflight, the new login/PIN/publish/reset/edit functions. **Existing challenges become `review`**, so nothing is assigned until you approve the pool. | Yes for the schema. The old app's assignment code ignores `pool_status`. |

### 9.2 Staging first (requires your approval, because it costs money)
Production and preview currently share one Supabase database, so a separate staging database is needed. Options:
- (a) A Supabase **branch** of the production project. It is billed hourly while it exists, and Supabase asks for cost confirmation.
- (b) A new Supabase project. The free-tier active-project limit is already reached, so this means pausing another project or using a paid plan.

Steps once one exists:
1. Apply `0001`…`0005` to staging, in order.
2. Point a Vercel **Preview** environment at it. Set preview-scoped `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `EVENT_SECRET` and `PIN_PEPPER`, with values different from production.
3. Seed it with synthetic data only (`tests/stack/seed-staging.ts`, pointed at staging).
4. Run the HTTP suite and k6 (`tests/load/*.js` with `APP_URL` set to the preview URL) to get **real-infrastructure numbers**.
5. Run `tests/db/rollback.sh`'s down → up sequence once against staging.

### 9.3 Production (each step needs your explicit go-ahead)
1. Take a backup: Supabase dashboard → Database → Backups, or `pg_dump`.
2. Set `PIN_PEPPER` (Production scope) in Vercel.
3. Apply `0003`, `0004` and `0005` to production, in that order and one at a time, checking for errors after each.
4. Merge PR #4 into `main`, which triggers the Vercel production deploy. **Everyone must sign in again**, because the cookie format changed.
5. Admin → Challenge pool → Import: upload the final workbook, then **Merge** + **approved**. Then mark `CH-*` / `GK-*` as **test**, choose Common A/B and confirm the rules (Easy excluded).
6. Registration desk → **Generate missing PINs**, then print the slips (or download the CSV) and store them securely.
7. Smoke test with one test entry: check in, log in with its PIN, Start, answer, Stop, Run evaluation. Then **Reset Competition Data** and delete the test entry.
8. Confirm that the dashboard readiness check is green.

### 9.4 Rollback
- **App rollback (preferred, no data loss):** promote the previous production deployment in Vercel. 0004 and 0005 are additive, and the old app runs against them. Users must sign in again.
- **Database rollback (only if really needed):** `supabase/rollback/0005_down.sql`, then `supabase/rollback/0004_down.sql`.
  - These **drop** PIN hashes, pool status, import history, assignment snapshots, rules, sessions and entry numbers. They keep participants, members, challenges and submissions.
  - Re-applying `0004` and `0005` afterwards works; this was tested locally (`tests/db/rollback.sh`).
  - Take a backup first.

---

## 10. Known risks and limitations
- **Not tested on Vercel + Supabase at 200 users.** The local numbers above are an upper bound for 2 vCPU, not a production measurement.
- **Login burst p95 of 2.5 s and timer storm p95 of 3.7 s** missed their targets on the local box. Both should be re-measured on staging.
- **Gemini quota.** About 800 evaluations are needed for 200 entries. On the free tier (~10 requests/min for 2.5 Flash) that is about 80 minutes; on a paid tier with `GEMINI_CONCURRENCY=4` it is a few minutes. Failures can be retried.
- **PIN distribution is a physical process.** Slips are shown once. A lost slip means re-issuing the PIN at the desk.
- **The UI was verified** by build, lint and HTTP tests, plus manual reasoning. It was **not** screenshot-tested in a real browser.
- **Round 2 / judge scoring is not implemented** (unchanged). Reset already clears its tables.
- **Difficulty data in the workbook:** 5 rows are unrated and 1 has a blank category. They are excluded from slots 3–4 until rated.

## 11. Decisions and data still needed from you
1. **Staging database:** a Supabase branch or a new project. Both cost money; this needs your OK.
2. **Approval to apply 0003/0004/0005 to production and merge PR #4**, after staging.
3. **Set `PIN_PEPPER`** in Vercel (Production + Preview, with different values) before PINs are issued.
4. **Keep the room access code in addition to the PIN?** It is currently required, and it stops a team logging in from outside the hall. It could be made optional if you prefer.
5. **Default limits** for PS rows without limits: 150 words / 2000 characters?
6. **Which PS IDs are Common A and Common B?**
7. **Mark `CH-*` and `GK-001…005` as test?** (Recommended.)
8. **Workbook fixes:** the `CRW-034` duplicate ID, the 5 unrated rows and the 1 blank-category row.
9. **Should Expert be eligible for slots 3–4?** There are only 7, so it barely changes the pool. And should slots 3/4 use different difficulties?
10. **Event date**, so the deployment timeline can be planned.
