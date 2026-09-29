-- Prompt Engineering Battle — core schema
-- Run in order. Uses UUID PKs, FKs, indexes, and RLS.

create extension if not exists "pgcrypto";

-- =========================================================
-- ROLES / USERS
-- =========================================================

create table admins (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  full_name text not null,
  role text not null default 'admin' check (role in ('admin','volunteer')),
  created_at timestamptz not null default now()
);

create table judges (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- =========================================================
-- PARTICIPANTS / ENTRIES
-- An "entry" is the scoring unit (1 solo participant OR a 2-person team).
-- =========================================================

create table entries (
  id uuid primary key default gen_random_uuid(),
  entry_code text unique not null,          -- human-readable: ENTRY-001
  registration_id text unique not null,     -- original id from CSV, never overwritten
  team_name text,
  payment_status text not null default 'unpaid' check (payment_status in ('paid','unpaid','waived')),
  is_team boolean not null default false,
  present boolean not null default false,
  present_at timestamptz,
  disqualified boolean not null default false,
  disqualified_reason text,
  login_entry_code_hash text,               -- optional, if per-entry secret is added later
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  member_position smallint not null check (member_position in (1,2)),
  full_name text not null,
  email text,
  phone text,
  present boolean not null default false,
  unique (entry_id, member_position)
);

create index idx_team_members_entry on team_members(entry_id);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  marked_by uuid references admins(id),
  marked_at timestamptz not null default now(),
  status text not null default 'present' check (status in ('present','absent'))
);

create index idx_attendance_entry on attendance(entry_id);

-- =========================================================
-- EVENT SETTINGS / ACCESS CODES
-- =========================================================

create table event_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
-- seeded keys include: demo_mode, round1_duration_seconds, round1_challenge_seconds,
-- qualification_percent, final_score_formula, round2_default_duration_seconds,
-- jury_score_breakdown, round2_ai_weights

create table event_access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz not null,
  generated_by uuid references admins(id),
  created_at timestamptz not null default now()
);

create index idx_access_codes_window on event_access_codes(valid_from, valid_to);

-- =========================================================
-- ROUNDS (server-authoritative timing lives here)
-- =========================================================

create table rounds (
  id uuid primary key default gen_random_uuid(),
  round_number smallint not null unique check (round_number in (1,2)),
  status text not null default 'not_started'
    check (status in ('not_started','running','paused','ended')),
  round_start_at timestamptz,
  round_end_at timestamptz,
  paused_at timestamptz,
  total_paused_seconds integer not null default 0,
  config jsonb not null default '{}'::jsonb, -- e.g. per-challenge seconds for round 1
  created_at timestamptz not null default now()
);

-- =========================================================
-- CHALLENGES / ASSIGNMENTS (Round 1)
-- =========================================================

create table challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_code text unique not null,
  title text not null,
  problem_statement text not null,
  instructions text,
  constraints text,
  expected_output text,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  active boolean not null default true,
  created_by uuid references admins(id),
  created_at timestamptz not null default now()
);

create index idx_challenges_active on challenges(active);

create table challenge_assignments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  round_id uuid not null references rounds(id),
  challenge_id uuid not null references challenges(id),
  position smallint not null check (position between 1 and 4),
  is_common boolean not null default false,
  assigned_at timestamptz not null default now(),
  locked_at timestamptz,
  unique (entry_id, round_id, position)
);

create index idx_assignments_entry_round on challenge_assignments(entry_id, round_id);
create index idx_assignments_challenge on challenge_assignments(challenge_id);

-- =========================================================
-- SUBMISSIONS (Round 1)
-- =========================================================

create table submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references challenge_assignments(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  prompt_text text not null default '',
  ai_output_text text not null default '',
  status text not null default 'draft'
    check (status in ('draft','locked','submitted')),
  question_start_at timestamptz,
  question_end_at timestamptz,
  submitted_at timestamptz,
  last_saved_at timestamptz not null default now(),
  submission_ref text, -- e.g. R1-ENTRY001-XXXX, set on final submit
  unique (assignment_id)
);

create index idx_submissions_entry on submissions(entry_id);
create index idx_submissions_status on submissions(status);

create table submission_versions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  prompt_text text not null,
  ai_output_text text not null,
  saved_at timestamptz not null default now()
);

create index idx_submission_versions_submission on submission_versions(submission_id);

-- =========================================================
-- AI EVALUATION (Round 1)
-- =========================================================

create table evaluation_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed')),
  retry_count integer not null default 0,
  last_error text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  evaluated_at timestamptz,
  unique (submission_id)
);

create index idx_eval_jobs_status on evaluation_jobs(status);

create table ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  prompt_clarity numeric(4,1) not null,
  context numeric(4,1) not null,
  specificity numeric(4,1) not null,
  creativity numeric(4,1) not null,
  constraint_handling numeric(4,1) not null,
  total numeric(5,1) not null,
  flags jsonb not null default '[]'::jsonb,
  summary text,
  raw_model_response jsonb,
  evaluated_at timestamptz not null default now(),
  unique (submission_id)
);

create table human_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  reviewer_id uuid references admins(id),
  old_total numeric(5,1),
  new_total numeric(5,1) not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- ROUND 1 RESULTS / QUALIFICATION
-- =========================================================

create table round_results (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  round_id uuid not null references rounds(id),
  score numeric(6,1) not null,
  rank integer,
  qualified boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (entry_id, round_id)
);

create index idx_round_results_round on round_results(round_id);

-- =========================================================
-- ROUND 2
-- =========================================================

create table round2_problems (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  problem_statement text not null,
  is_common boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table round2_assignments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  problem_id uuid not null references round2_problems(id),
  assigned_at timestamptz not null default now(),
  unique (entry_id)
);

create table surprise_twists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  active boolean not null default true
);

create table round2_states (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  state text not null default 'R2_WAITING' check (state in (
    'R2_WAITING','R2_STARTED','INITIAL_PROMPT','OUTPUT','JURY_PHASE',
    'SURPRISE_REVEALED','REFINEMENT','FINAL_SUBMISSION','EVALUATION','RESULT'
  )),
  twist_id uuid references surprise_twists(id),
  twist_revealed_at timestamptz,
  initial_prompt text,
  initial_output text,
  final_prompt text,
  final_output text,
  rationale text,
  final_submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (entry_id)
);

create table judge_questions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  judge_id uuid references judges(id),
  question text not null,
  answer text,
  asked_at timestamptz not null default now(),
  answered_at timestamptz
);

create index idx_judge_questions_entry on judge_questions(entry_id);

create table judge_scores (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  judge_id uuid not null references judges(id),
  understanding numeric(4,1) not null default 0,
  response_quality numeric(4,1) not null default 0,
  adaptability numeric(4,1) not null default 0,
  interaction numeric(4,1) not null default 0,
  total numeric(4,1) not null default 0,
  notes text,
  locked boolean not null default false,
  saved_at timestamptz not null default now(),
  unique (entry_id, judge_id)
);

create table round2_ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  problem_understanding numeric(4,1) not null,
  prompt_structure numeric(4,1) not null,
  context_specificity numeric(4,1) not null,
  creativity numeric(4,1) not null,
  constraint_handling numeric(4,1) not null,
  output_quality numeric(4,1) not null,
  ai_subtotal numeric(5,1) not null, -- sum of above (max 90)
  summary text,
  raw_model_response jsonb,
  evaluated_at timestamptz not null default now(),
  unique (entry_id)
);

create table final_results (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  round1_score numeric(6,1) not null,
  round2_score numeric(6,1) not null,
  final_score numeric(6,1) not null,
  rank integer,
  released boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (entry_id)
);

-- =========================================================
-- LOGGING
-- =========================================================

create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries(id) on delete set null,
  user_id uuid,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_activity_logs_entry on activity_logs(entry_id);
create index idx_activity_logs_event on activity_logs(event_type);
create index idx_activity_logs_created on activity_logs(created_at);

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references admins(id),
  entry_id uuid references entries(id),
  action text not null,
  reason text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index idx_admin_actions_entry on admin_actions(entry_id);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  active boolean not null default true,
  created_by uuid references admins(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- updated_at trigger helper
-- =========================================================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_entries_updated before update on entries
  for each row execute function set_updated_at();
create trigger trg_round2_states_updated before update on round2_states
  for each row execute function set_updated_at();
