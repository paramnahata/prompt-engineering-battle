-- =====================================================================
-- 0004 — Event-readiness hardening
--
-- * Numeric entry numbers (students type 1, 2, 3 — entry_code stays for
--   backwards compatibility).
-- * Richer per-member registration data (each member keeps their own
--   contact + college details).
-- * Explicit "common" challenge slots instead of "whatever Postgres returns
--   first".
-- * Server-side sessions (revocable logout, live online status, one active
--   device per entry).
-- * DB-backed rate limiting (serverless instances share no memory).
-- * Atomic Round 1 lifecycle, autosave, advance/submit, evaluation-queue
--   claiming, results computation and participant import, each as a single
--   transactional function so concurrent requests can't corrupt state.
--
-- Additive and backwards compatible with existing rows. Every function is
-- revoked from anon/authenticated and only executable by service_role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Entries: numeric entry number
-- ---------------------------------------------------------------------
alter table entries add column if not exists entry_number integer;

update entries
   set entry_number = nullif(regexp_replace(entry_code, '\D', '', 'g'), '')::integer
 where entry_number is null
   and regexp_replace(entry_code, '\D', '', 'g') <> ''
   and not exists (
     select 1 from entries e2
      where e2.id <> entries.id
        and nullif(regexp_replace(e2.entry_code, '\D', '', 'g'), '')::integer
            = nullif(regexp_replace(entries.entry_code, '\D', '', 'g'), '')::integer
   );

with m as (select coalesce(max(entry_number), 0) as mx from entries),
     n as (select id, row_number() over (order by created_at, id) as rn from entries where entry_number is null)
update entries e set entry_number = m.mx + n.rn from m, n where e.id = n.id;

alter table entries alter column entry_number set not null;
create unique index if not exists entries_entry_number_key on entries(entry_number);
do $$ begin
  alter table entries add constraint entries_entry_number_positive check (entry_number > 0);
exception when duplicate_object then null; end $$;

-- Rows inserted without entry_number (e.g. by the previous app version while
-- this migration is live but the new code is not yet deployed) get one
-- derived from entry_code, or the next free number.
create or replace function entries_fill_entry_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.entry_number is null then
    new.entry_number := nullif(regexp_replace(coalesce(new.entry_code, ''), '\D', '', 'g'), '')::integer;
    if new.entry_number is null or exists (select 1 from entries where entry_number = new.entry_number) then
      select coalesce(max(entry_number), 0) + 1 into new.entry_number from entries;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_entries_fill_entry_number on entries;
create trigger trg_entries_fill_entry_number before insert on entries
  for each row execute function entries_fill_entry_number();

-- ---------------------------------------------------------------------
-- Team members: per-member details, up to 4 members per entry
-- ---------------------------------------------------------------------
alter table team_members add column if not exists gender text;
alter table team_members add column if not exists college text;
alter table team_members add column if not exists city text;
alter table team_members add column if not exists branch text;
alter table team_members add column if not exists study_year text;
alter table team_members add column if not exists source_row integer;

alter table team_members drop constraint if exists team_members_member_position_check;
do $$ begin
  alter table team_members add constraint team_members_member_position_check check (member_position between 1 and 4);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Challenges: explicit common slots
-- ---------------------------------------------------------------------
alter table challenges add column if not exists common_slot smallint;
do $$ begin
  alter table challenges add constraint challenges_common_slot_check check (common_slot in (1, 2));
exception when duplicate_object then null; end $$;
create unique index if not exists challenges_common_slot_key on challenges(common_slot) where common_slot is not null;

-- ---------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------
create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin', 'volunteer', 'judge', 'student')),
  subject_id uuid not null,
  entry_id uuid references entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  client_visible boolean not null default true,
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  user_agent text
);
create index if not exists idx_auth_sessions_entry_active on auth_sessions(entry_id) where ended_at is null;
create index if not exists idx_auth_sessions_subject_active on auth_sessions(subject_id) where ended_at is null;
create index if not exists idx_auth_sessions_role_seen on auth_sessions(role, last_seen_at desc);
alter table auth_sessions enable row level security;

-- ---------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table rate_limits enable row level security;

-- ---------------------------------------------------------------------
-- Evaluation bookkeeping
-- ---------------------------------------------------------------------
alter table evaluation_jobs add column if not exists next_attempt_at timestamptz not null default now();
alter table evaluation_jobs add column if not exists model text;
alter table evaluation_jobs add column if not exists rubric_version text;
alter table ai_evaluations add column if not exists model text;
alter table ai_evaluations add column if not exists rubric_version text;

-- ---------------------------------------------------------------------
-- Indexes matching real query patterns
-- ---------------------------------------------------------------------
create index if not exists idx_assignments_round on challenge_assignments(round_id);
create index if not exists idx_submission_versions_recent on submission_versions(submission_id, saved_at desc);
create index if not exists idx_eval_jobs_claim on evaluation_jobs(status, next_attempt_at);
create index if not exists idx_human_reviews_submission on human_reviews(submission_id, created_at desc);
create index if not exists idx_activity_logs_entry_created on activity_logs(entry_id, created_at desc);
create index if not exists idx_round_results_round_rank on round_results(round_id, rank);

-- Existing functions: pin search_path (Supabase advisor 0011).
alter function set_updated_at() set search_path = public;
alter function log_attendance_on_present_change() set search_path = public;

-- =====================================================================
-- FUNCTIONS
-- =====================================================================

-- Fixed-window rate limiter. Returns true when the request is allowed.
-- p_increment=false only peeks (used to check a failure counter).
create or replace function rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer, p_increment boolean default true)
returns boolean language plpgsql set search_path = public as $$
declare v_hits integer;
begin
  if p_increment then
    insert into rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
    on conflict (key) do update set
      hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
      window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
    returning hits into v_hits;
    return v_hits <= p_limit;
  end if;
  select case when window_start < now() - make_interval(secs => p_window_seconds) then 0 else hits end
    into v_hits from rate_limits where key = p_key;
  return coalesce(v_hits, 0) < p_limit;
end $$;

-- Validates a session id; optionally records a heartbeat. Ends sessions
-- whose account was removed, demoted, deactivated or disqualified.
create or replace function auth_session_validate(p_sid uuid, p_touch boolean default true, p_visible boolean default null)
returns jsonb language plpgsql set search_path = public as $$
declare s auth_sessions; v_ok boolean; v_entry_number integer;
begin
  select * into s from auth_sessions where id = p_sid;
  if not found or s.ended_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'ended');
  end if;
  if s.expires_at <= now() then
    update auth_sessions set ended_at = now(), end_reason = 'expired' where id = p_sid and ended_at is null;
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  if s.role in ('admin', 'volunteer') then
    select exists (select 1 from admins where id = s.subject_id and role = s.role) into v_ok;
  elsif s.role = 'judge' then
    select exists (select 1 from judges where id = s.subject_id and active) into v_ok;
  else
    select entry_number into v_entry_number from entries where id = s.subject_id and not disqualified;
    v_ok := found;
  end if;

  if not v_ok then
    update auth_sessions set ended_at = now(), end_reason = 'account_changed' where id = p_sid and ended_at is null;
    return jsonb_build_object('valid', false, 'reason', 'account_changed');
  end if;

  if p_touch and (s.last_seen_at < now() - interval '10 seconds'
                  or (p_visible is not null and p_visible is distinct from s.client_visible)) then
    update auth_sessions set last_seen_at = now(), client_visible = coalesce(p_visible, client_visible) where id = p_sid;
  end if;

  return jsonb_build_object('valid', true, 'role', s.role, 'subject_id', s.subject_id,
                            'entry_id', s.entry_id, 'entry_number', v_entry_number);
end $$;

-- Internal: is this a live student session for this entry? Touches last_seen.
create or replace function _student_session_ok(p_sid uuid, p_entry uuid)
returns boolean language plpgsql set search_path = public as $$
declare v_seen timestamptz;
begin
  select last_seen_at into v_seen from auth_sessions
   where id = p_sid and entry_id = p_entry and role = 'student'
     and ended_at is null and expires_at > now();
  if not found then return false; end if;
  if v_seen < now() - interval '10 seconds' then
    update auth_sessions set last_seen_at = now() where id = p_sid;
  end if;
  return true;
end $$;

-- Student login: rate limits, entry checks, one live device per entry,
-- idempotent for a browser that already holds a valid session.
create or replace function student_login(
  p_entry_number integer, p_code_ok boolean, p_ip text, p_user_agent text,
  p_existing_sid uuid, p_ttl_seconds integer, p_active_window_seconds integer)
returns jsonb language plpgsql set search_path = public as $$
declare e entries; v_sid uuid; v_active integer;
begin
  -- Generous per-IP cap: a whole college can sit behind one NAT address.
  if not rate_limit_hit('student-login-ip:' || coalesce(p_ip, 'unknown'), 600, 60) then
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited');
  end if;
  if not rate_limit_hit('student-login-entry:' || p_entry_number, 8, 300, false) then
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited');
  end if;
  if not p_code_ok then
    perform rate_limit_hit('student-login-entry:' || p_entry_number, 8, 300, true);
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'bad_access_code');
  end if;

  select * into e from entries where entry_number = p_entry_number for update;
  if not found then
    perform rate_limit_hit('student-login-entry:' || p_entry_number, 8, 300, true);
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found');
  end if;
  if e.disqualified then return jsonb_build_object('ok', false, 'status', 403, 'code', 'disqualified'); end if;
  if not e.present then return jsonb_build_object('ok', false, 'status', 403, 'code', 'not_checked_in'); end if;

  if p_existing_sid is not null and exists (
       select 1 from auth_sessions where id = p_existing_sid and entry_id = e.id
          and ended_at is null and expires_at > now()) then
    update auth_sessions set last_seen_at = now() where id = p_existing_sid;
    return jsonb_build_object('ok', true, 'sid', p_existing_sid, 'entry_id', e.id,
                              'entry_number', e.entry_number, 'reused', true);
  end if;

  select count(*) into v_active from auth_sessions
   where entry_id = e.id and ended_at is null and expires_at > now()
     and last_seen_at > now() - make_interval(secs => p_active_window_seconds);
  if v_active > 0 then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'already_active');
  end if;

  update auth_sessions set ended_at = now(), end_reason = 'superseded'
   where entry_id = e.id and ended_at is null;

  insert into auth_sessions (role, subject_id, entry_id, expires_at, user_agent)
  values ('student', e.id, e.id, now() + make_interval(secs => p_ttl_seconds), left(p_user_agent, 200))
  returning id into v_sid;

  insert into activity_logs (entry_id, event_type, metadata)
  values (e.id, 'login', jsonb_build_object('session_id', v_sid));

  return jsonb_build_object('ok', true, 'sid', v_sid, 'entry_id', e.id,
                            'entry_number', e.entry_number, 'reused', false);
end $$;

-- ---------------------------------------------------------------------
-- Round 1 internals
-- ---------------------------------------------------------------------

-- Submits every not-yet-submitted Round 1 answer for one entry under one
-- reference, locks the assignments and queues AI evaluation.
create or replace function _round1_submit_entry(p_entry uuid, p_round uuid, p_reason text)
returns text language plpgsql set search_path = public as $$
declare v_ref text; v_number integer; v_count integer;
begin
  select submission_ref into v_ref from submissions s
    join challenge_assignments a on a.id = s.assignment_id
   where s.entry_id = p_entry and a.round_id = p_round and s.submission_ref is not null
   limit 1;
  if v_ref is null then
    select entry_number into v_number from entries where id = p_entry;
    v_ref := 'R1-' || v_number || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
  end if;

  update submissions s
     set status = 'submitted', submitted_at = coalesce(s.submitted_at, now()), submission_ref = v_ref
    from challenge_assignments a
   where a.id = s.assignment_id and a.round_id = p_round and s.entry_id = p_entry and s.status <> 'submitted';
  get diagnostics v_count = row_count;

  update challenge_assignments set locked_at = coalesce(locked_at, now())
   where entry_id = p_entry and round_id = p_round;

  insert into evaluation_jobs (submission_id, status, next_attempt_at)
  select s.id, 'queued', now() from submissions s
    join challenge_assignments a on a.id = s.assignment_id
   where s.entry_id = p_entry and a.round_id = p_round
  on conflict (submission_id) do nothing;

  if v_count > 0 then
    insert into activity_logs (entry_id, event_type, metadata)
    values (p_entry, 'submission', jsonb_build_object('submission_ref', v_ref, 'reason', p_reason));
  end if;
  return v_ref;
end $$;

-- Ends a round: submits every entry's outstanding work so nothing is lost.
create or replace function _round1_finalize(p_round uuid, p_reason text)
returns integer language plpgsql set search_path = public as $$
declare r record; v_entries integer := 0;
begin
  for r in
    select distinct s.entry_id from submissions s
      join challenge_assignments a on a.id = s.assignment_id
     where a.round_id = p_round and s.status <> 'submitted'
  loop
    perform _round1_submit_entry(r.entry_id, p_round, p_reason);
    v_entries := v_entries + 1;
  end loop;
  return v_entries;
end $$;

-- Lazily ends a running round once its server deadline (plus a short grace
-- for in-flight final saves) has passed. Cheap when nothing needs doing.
create or replace function round1_tick()
returns text language plpgsql set search_path = public as $$
declare r rounds;
begin
  select * into r from rounds where round_number = 1;
  if not found then return 'missing'; end if;
  if r.status <> 'running' or r.round_end_at is null or r.round_end_at > now() - interval '20 seconds' then
    return r.status;
  end if;
  select * into r from rounds where id = r.id for update;
  if r.status = 'running' and r.round_end_at <= now() - interval '20 seconds' then
    update rounds set status = 'ended' where id = r.id;
    perform _round1_finalize(r.id, 'round_time_up');
    insert into admin_actions (action, old_value, new_value)
    values ('auto_end_round1', jsonb_build_object('status', 'running'), jsonb_build_object('status', 'ended', 'round_end_at', r.round_end_at));
    update announcements set active = false where active and message like 'Round 1%';
    insert into announcements (message, active) values ('Round 1 time is up. All answers have been submitted.', true);
    return 'ended';
  end if;
  return r.status;
end $$;

-- Assigns challenges to present, non-disqualified entries that have none yet.
-- Positions 1-2: the two configured common challenges. Positions 3-4: two
-- distinct challenges from a shuffled pool, round-robin, so usage stays
-- balanced (each pool challenge is used at most ceil(2N/pool) times).
create or replace function _round1_assign_missing(p_round uuid)
returns integer language plpgsql set search_path = public as $$
declare v_common_a uuid; v_common_b uuid; v_pool integer; v_count integer;
begin
  select id into v_common_a from challenges where common_slot = 1 and active;
  select id into v_common_b from challenges where common_slot = 2 and active;
  if v_common_a is null or v_common_b is null then
    return -1;  -- common challenges not configured
  end if;
  select count(*) into v_pool from challenges where active and common_slot is null;
  if v_pool < 2 then return -2; end if;  -- random pool too small

  create temporary table _ents on commit drop as
    select id, (row_number() over (order by random()) - 1)::integer as i
      from entries
     where present and not disqualified
       and id not in (select entry_id from challenge_assignments where round_id = p_round);
  create temporary table _pool on commit drop as
    select id, (row_number() over (order by random()) - 1)::integer as idx
      from challenges where active and common_slot is null;

  insert into challenge_assignments (entry_id, round_id, challenge_id, position, is_common)
  select e.id, p_round, v_common_a, 1, true from _ents e
  union all
  select e.id, p_round, v_common_b, 2, true from _ents e
  union all
  select e.id, p_round, p.id, 3, false from _ents e join _pool p on p.idx = (2 * e.i) % v_pool
  union all
  select e.id, p_round, p.id, 4, false from _ents e join _pool p on p.idx = (2 * e.i + 1) % v_pool;

  select count(*) into v_count from _ents;
  drop table _ents; drop table _pool;

  insert into submissions (assignment_id, entry_id)
  select a.id, a.entry_id from challenge_assignments a where a.round_id = p_round
  on conflict (assignment_id) do nothing;

  return v_count;
end $$;

create or replace function _round1_assign_error(p_code integer)
returns jsonb language sql immutable set search_path = public as $$
  select case p_code
    when -1 then jsonb_build_object('ok', false, 'status', 409, 'code', 'common_not_configured',
      'message', 'Choose the two common challenges (Common A and Common B) on the Challenges page first.')
    else jsonb_build_object('ok', false, 'status', 409, 'code', 'pool_too_small',
      'message', 'At least two active non-common challenges are needed for the random slots.')
  end
$$;

-- Single entry point for every admin round action. The round row is locked
-- for the whole transaction, so concurrent clicks are serialized and every
-- transition is validated against the current state.
create or replace function round1_control(p_action text, p_admin uuid, p_confirm text default null)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_delta interval; v_assigned integer; v_finalized integer; v_deleted integer; v_duration integer;
begin
  perform round1_tick();
  select * into r from rounds where round_number = 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'round_missing', 'message', 'Round 1 is not configured.');
  end if;

  if p_action = 'start' then
    if r.status <> 'not_started' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state',
        'message', 'Round 1 is ' || r.status || '. Only a not-started round can be started.');
    end if;
    v_assigned := _round1_assign_missing(r.id);
    if v_assigned < 0 then return _round1_assign_error(v_assigned); end if;
    if v_assigned = 0 and not exists (select 1 from challenge_assignments where round_id = r.id) then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'no_entries',
        'message', 'No checked-in entries. Mark attendance before starting Round 1.');
    end if;
    v_duration := coalesce((r.config ->> 'round_duration_seconds')::integer, 1800);
    update rounds set status = 'running', round_start_at = now(),
           round_end_at = now() + make_interval(secs => v_duration),
           paused_at = null, total_paused_seconds = 0
     where id = r.id;
    insert into admin_actions (admin_id, action, new_value)
    values (p_admin, 'start_round1', jsonb_build_object('assigned', v_assigned, 'duration_seconds', v_duration));
    update announcements set active = false where active and message like 'Round 1%';
    insert into announcements (message, active, created_by) values ('Round 1 has started!', true, p_admin);
    return jsonb_build_object('ok', true, 'roundStatus', 'running', 'assigned', v_assigned);

  elsif p_action = 'assign_missing' then
    if r.status not in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Late arrivals can only be assigned while Round 1 is running or paused.');
    end if;
    v_assigned := _round1_assign_missing(r.id);
    if v_assigned < 0 then return _round1_assign_error(v_assigned); end if;
    insert into admin_actions (admin_id, action, new_value) values (p_admin, 'assign_late_round1', jsonb_build_object('assigned', v_assigned));
    return jsonb_build_object('ok', true, 'roundStatus', r.status, 'assigned', v_assigned);

  elsif p_action = 'pause' then
    if r.status <> 'running' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Round 1 is ' || r.status || '; only a running round can be paused.');
    end if;
    update rounds set status = 'paused', paused_at = now() where id = r.id;
    insert into admin_actions (admin_id, action, old_value, new_value)
    values (p_admin, 'pause_round1', jsonb_build_object('status', 'running'), jsonb_build_object('status', 'paused'));
    update announcements set active = false where active and message like 'Round 1%';
    insert into announcements (message, active, created_by) values ('Round 1 is paused. Timers are frozen.', true, p_admin);
    return jsonb_build_object('ok', true, 'roundStatus', 'paused');

  elsif p_action = 'resume' then
    if r.status <> 'paused' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Round 1 is ' || r.status || '; only a paused round can be resumed.');
    end if;
    v_delta := now() - coalesce(r.paused_at, now());
    update rounds set status = 'running', paused_at = null,
           round_end_at = round_end_at + v_delta,
           total_paused_seconds = total_paused_seconds + ceil(extract(epoch from v_delta))::integer
     where id = r.id;
    -- Give every in-progress challenge back exactly the time spent paused.
    update submissions s set question_end_at = s.question_end_at + v_delta
      from challenge_assignments a
     where a.id = s.assignment_id and a.round_id = r.id and s.status = 'draft'
       and s.question_end_at is not null and s.question_end_at > coalesce(r.paused_at, now());
    insert into admin_actions (admin_id, action, old_value, new_value)
    values (p_admin, 'resume_round1', jsonb_build_object('status', 'paused'),
            jsonb_build_object('status', 'running', 'paused_seconds', ceil(extract(epoch from v_delta))));
    update announcements set active = false where active and message like 'Round 1%';
    insert into announcements (message, active, created_by) values ('Round 1 has resumed.', true, p_admin);
    return jsonb_build_object('ok', true, 'roundStatus', 'running', 'pausedSeconds', ceil(extract(epoch from v_delta)));

  elsif p_action = 'stop' then
    if r.status not in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Round 1 must be running or paused to stop it.');
    end if;
    update rounds set status = 'ended', round_end_at = now(), paused_at = null where id = r.id;
    v_finalized := _round1_finalize(r.id, 'stopped_by_admin');
    insert into admin_actions (admin_id, action, old_value, new_value)
    values (p_admin, 'stop_round1', jsonb_build_object('status', r.status),
            jsonb_build_object('status', 'ended', 'entries_finalized', v_finalized));
    update announcements set active = false where active and message like 'Round 1%';
    insert into announcements (message, active, created_by) values ('Round 1 has ended. All answers have been submitted.', true, p_admin);
    return jsonb_build_object('ok', true, 'roundStatus', 'ended', 'entriesFinalized', v_finalized);

  elsif p_action = 'reset' then
    if coalesce(p_confirm, '') <> 'START OVER' then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'confirmation_required', 'message', 'Type START OVER to confirm.');
    end if;
    if r.status in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Stop Round 1 before starting over.');
    end if;
    select count(*) into v_deleted from challenge_assignments where round_id = r.id;
    -- Cascades: submissions -> submission_versions, evaluation_jobs, ai_evaluations, human_reviews.
    delete from challenge_assignments where round_id = r.id;
    delete from round_results where round_id = r.id;
    update rounds set status = 'not_started', round_start_at = null, round_end_at = null,
           paused_at = null, total_paused_seconds = 0
     where id = r.id;
    insert into admin_actions (admin_id, action, reason, old_value, new_value)
    values (p_admin, 'reset_round1', 'Start Over confirmed by admin',
            jsonb_build_object('status', r.status, 'assignments_deleted', v_deleted),
            jsonb_build_object('status', 'not_started', 'registrations_kept', true, 'attendance_kept', true));
    update announcements set active = false where active and message like 'Round 1%';
    insert into announcements (message, active, created_by) values ('Round 1 has been reset. Please wait for the organizer to start.', true, p_admin);
    return jsonb_build_object('ok', true, 'roundStatus', 'not_started', 'assignmentsDeleted', v_deleted);
  end if;

  return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_action', 'message', 'Unknown action.');
end $$;

-- Everything a student's Round 1 page needs, in one round trip. Lazily
-- starts the current challenge's timer and closes out challenges whose
-- timer expired while the student was away (so a closed laptop can't
-- leave the entry stuck on an expired question).
create or replace function student_round1_state(p_sid uuid, p_entry uuid)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; cur record; v_challenge_seconds integer; v_assignments jsonb; v_submissions jsonb; v_number integer;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session');
  end if;
  perform round1_tick();
  select entry_number into v_number from entries where id = p_entry;
  select * into r from rounds where round_number = 1;

  if r.id is null or r.status <> 'running' then
    return jsonb_build_object('ok', true, 'serverNow', now(), 'roundStatus', coalesce(r.status, 'not_started'),
      'roundEndAt', r.round_end_at, 'entryNumber', v_number, 'assignments', '[]'::jsonb, 'submissions', '[]'::jsonb,
      'currentSubmissionId', null);
  end if;

  v_challenge_seconds := coalesce((r.config ->> 'challenge_seconds')::integer, 450);

  loop
    select s.id, s.question_start_at, s.question_end_at, a.position into cur
      from submissions s join challenge_assignments a on a.id = s.assignment_id
     where s.entry_id = p_entry and a.round_id = r.id and s.status = 'draft'
     order by a.position limit 1
     for update of s;
    exit when not found;
    if cur.question_end_at is not null and cur.question_end_at < now() - interval '20 seconds' then
      if cur.position >= 4 then
        perform _round1_submit_entry(p_entry, r.id, 'timer_expired');
      else
        update submissions set status = 'locked' where id = cur.id;
        update challenge_assignments a set locked_at = now() from submissions s where s.id = cur.id and a.id = s.assignment_id;
      end if;
      continue;
    end if;
    if cur.question_start_at is null then
      update submissions
         set question_start_at = now(),
             question_end_at = least(now() + make_interval(secs => v_challenge_seconds), r.round_end_at)
       where id = cur.id;
    end if;
    exit;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'position', a.position, 'challenge_id', a.challenge_id, 'locked_at', a.locked_at,
           'challenge', jsonb_build_object('title', c.title, 'problem_statement', c.problem_statement,
             'instructions', c.instructions, 'constraints', c.constraints, 'expected_output', c.expected_output,
             'prompt_word_limit', c.prompt_word_limit, 'output_char_limit', c.output_char_limit))
           order by a.position), '[]'::jsonb)
    into v_assignments
    from challenge_assignments a join challenges c on c.id = a.challenge_id
   where a.entry_id = p_entry and a.round_id = r.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'assignment_id', s.assignment_id, 'status', s.status,
           'prompt_text', case when s.status = 'draft' then s.prompt_text else '' end,
           'ai_output_text', case when s.status = 'draft' then s.ai_output_text else '' end,
           'question_start_at', s.question_start_at, 'question_end_at', s.question_end_at,
           'submitted_at', s.submitted_at, 'submission_ref', s.submission_ref, 'position', a.position)
           order by a.position), '[]'::jsonb)
    into v_submissions
    from submissions s join challenge_assignments a on a.id = s.assignment_id
   where s.entry_id = p_entry and a.round_id = r.id;

  return jsonb_build_object('ok', true, 'serverNow', now(), 'roundStatus', r.status, 'roundEndAt', r.round_end_at,
    'entryNumber', v_number, 'assignments', v_assignments, 'submissions', v_submissions,
    'currentSubmissionId', (select s.id from submissions s join challenge_assignments a on a.id = s.assignment_id
                             where s.entry_id = p_entry and a.round_id = r.id and s.status = 'draft'
                             order by a.position limit 1));
end $$;

create or replace function _word_count(p_text text)
returns integer language sql immutable set search_path = public as $$
  select case when regexp_replace(coalesce(p_text, ''), '^\s+|\s+$', '', 'g') = '' then 0
              else array_length(regexp_split_to_array(regexp_replace(p_text, '^\s+|\s+$', '', 'g'), '\s+'), 1) end
$$;

-- Autosave: ownership, round state, per-question deadline and per-challenge
-- limits are all checked in the same transaction as the write.
create or replace function student_autosave(p_sid uuid, p_entry uuid, p_submission uuid, p_prompt text, p_output text)
returns jsonb language plpgsql set search_path = public as $$
declare v record; v_words integer;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session');
  end if;
  perform round1_tick();
  select s.id, s.entry_id, s.status, s.question_end_at, s.prompt_text, s.ai_output_text,
         c.prompt_word_limit, c.output_char_limit, r.status as round_status
    into v
    from submissions s
    join challenge_assignments a on a.id = s.assignment_id
    join challenges c on c.id = a.challenge_id
    join rounds r on r.id = a.round_id
   where s.id = p_submission
   for update of s;
  if not found then return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found'); end if;
  if v.entry_id <> p_entry then return jsonb_build_object('ok', false, 'status', 403, 'code', 'forbidden'); end if;
  if v.round_status = 'paused' then return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_paused'); end if;
  if v.round_status <> 'running' then return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_ended'); end if;
  if v.status <> 'draft' then return jsonb_build_object('ok', false, 'status', 409, 'code', 'locked'); end if;
  if v.question_end_at is null or now() > v.question_end_at + interval '5 seconds' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'expired');
  end if;
  v_words := _word_count(p_prompt);
  if v_words > v.prompt_word_limit then
    return jsonb_build_object('ok', false, 'status', 422, 'code', 'word_limit', 'limit', v.prompt_word_limit, 'count', v_words);
  end if;
  if char_length(p_output) > v.output_char_limit then
    return jsonb_build_object('ok', false, 'status', 422, 'code', 'char_limit', 'limit', v.output_char_limit);
  end if;

  if v.prompt_text is distinct from p_prompt or v.ai_output_text is distinct from p_output then
    update submissions set prompt_text = p_prompt, ai_output_text = p_output, last_saved_at = now() where id = p_submission;
    if not exists (select 1 from submission_versions where submission_id = p_submission and saved_at > now() - interval '20 seconds') then
      insert into submission_versions (submission_id, prompt_text, ai_output_text) values (p_submission, p_prompt, p_output);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'savedAt', now());
end $$;

-- Advance / final submit. Idempotent; the row lock makes double-fires and
-- multi-tab races harmless. Final text sent with the request is saved if it
-- arrives within 15s of the deadline (covers the autosave debounce gap).
create or replace function student_advance(p_sid uuid, p_entry uuid, p_submission uuid, p_prompt text, p_output text)
returns jsonb language plpgsql set search_path = public as $$
declare v record; v_ref text;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session');
  end if;
  perform round1_tick();
  select s.id, s.entry_id, s.status, s.question_end_at, s.submission_ref, a.position, a.round_id,
         c.prompt_word_limit, c.output_char_limit, r.status as round_status
    into v
    from submissions s
    join challenge_assignments a on a.id = s.assignment_id
    join challenges c on c.id = a.challenge_id
    join rounds r on r.id = a.round_id
   where s.id = p_submission
   for update of s;
  if not found then return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found'); end if;
  if v.entry_id <> p_entry then return jsonb_build_object('ok', false, 'status', 403, 'code', 'forbidden'); end if;
  if v.status <> 'draft' then
    return jsonb_build_object('ok', true, 'alreadyDone', true, 'finalSubmit', v.status = 'submitted', 'submissionRef', v.submission_ref);
  end if;
  if v.round_status = 'paused' then return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_paused'); end if;
  if v.round_status <> 'running' then return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_ended'); end if;
  if v.question_end_at is null then return jsonb_build_object('ok', false, 'status', 409, 'code', 'not_started'); end if;
  if now() < v.question_end_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'timer_not_expired',
      'secondsLeft', ceil(extract(epoch from v.question_end_at - now())));
  end if;

  if p_prompt is not null and p_output is not null and now() <= v.question_end_at + interval '15 seconds'
     and _word_count(p_prompt) <= v.prompt_word_limit and char_length(p_output) <= v.output_char_limit then
    update submissions set prompt_text = p_prompt, ai_output_text = p_output, last_saved_at = now() where id = p_submission;
  end if;

  if v.position < 4 then
    update submissions set status = 'locked' where id = p_submission;
    update challenge_assignments set locked_at = now() where id = (select assignment_id from submissions where id = p_submission);
    return jsonb_build_object('ok', true, 'finalSubmit', false);
  end if;

  v_ref := _round1_submit_entry(p_entry, v.round_id, 'final_submit');
  return jsonb_build_object('ok', true, 'finalSubmit', true, 'submissionRef', v_ref);
end $$;

-- ---------------------------------------------------------------------
-- Evaluation queue
-- ---------------------------------------------------------------------
create or replace function claim_evaluation_jobs(p_limit integer, p_max_retries integer default 4, p_stale_seconds integer default 180)
returns table (id uuid, submission_id uuid, retry_count integer)
language plpgsql set search_path = public as $$
begin
  -- Reclaim jobs whose worker died mid-flight (function timeout, crash).
  update evaluation_jobs j
     set status = case when j.retry_count + 1 >= p_max_retries then 'failed' else 'queued' end,
         retry_count = j.retry_count + 1,
         last_error = 'Worker did not finish (timed out); re-queued',
         next_attempt_at = now()
   where j.status = 'processing' and j.started_at < now() - make_interval(secs => p_stale_seconds);

  return query
  with c as (
    select j.id from evaluation_jobs j
     where j.status = 'queued' and j.next_attempt_at <= now()
     order by j.queued_at
     limit p_limit
     for update skip locked
  )
  update evaluation_jobs j set status = 'processing', started_at = now()
    from c where j.id = c.id
  returning j.id, j.submission_id, j.retry_count;
end $$;

-- ---------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------
create or replace function compute_round1_results(p_admin uuid, p_percent numeric, p_force boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_pending integer; v_total integer; v_qualify integer;
begin
  select * into r from rounds where round_number = 1 for update;
  if r.status <> 'ended' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'End Round 1 before computing results.');
  end if;
  select count(*) into v_pending from evaluation_jobs j
    join submissions s on s.id = j.submission_id
    join challenge_assignments a on a.id = s.assignment_id
   where a.round_id = r.id and j.status in ('queued', 'processing', 'failed');
  if v_pending > 0 and not p_force then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'pending_evaluations', 'pending', v_pending,
      'message', v_pending || ' evaluation(s) are queued or failed. Finish or retry them first, or compute anyway.');
  end if;

  delete from round_results where round_id = r.id;

  with per_sub as (
    select s.entry_id,
           coalesce((select hr.new_total from human_reviews hr where hr.submission_id = s.id order by hr.created_at desc limit 1),
                    ae.total, 0) as score
      from submissions s
      join challenge_assignments a on a.id = s.assignment_id
      left join ai_evaluations ae on ae.submission_id = s.id
     where a.round_id = r.id
  ), per_entry as (
    select p.entry_id, sum(p.score) as score
      from per_sub p join entries e on e.id = p.entry_id
     where not e.disqualified
     group by p.entry_id
  ), ranked as (
    select entry_id, score, rank() over (order by score desc) as rnk, count(*) over () as n from per_entry
  )
  insert into round_results (entry_id, round_id, score, rank, qualified, computed_at)
  select entry_id, r.id, score, rnk, rnk <= greatest(1, ceil(n * p_percent / 100.0)), now() from ranked;

  get diagnostics v_total = row_count;
  select count(*) into v_qualify from round_results where round_id = r.id and qualified;
  insert into admin_actions (admin_id, action, new_value)
  values (p_admin, 'compute_round1_results', jsonb_build_object('entries', v_total, 'qualified', v_qualify,
          'percent', p_percent, 'forced', p_force, 'pending_at_compute', v_pending));
  return jsonb_build_object('ok', true, 'entries', v_total, 'qualified', v_qualify, 'pendingAtCompute', v_pending);
end $$;

-- ---------------------------------------------------------------------
-- Live participants (organizer dashboard)
-- ---------------------------------------------------------------------
create or replace function admin_live_participants(p_online_seconds integer default 45, p_idle_seconds integer default 180)
returns table (
  entry_id uuid, entry_number integer, team_name text, member_names text, present boolean,
  session_started_at timestamptz, last_seen_at timestamptz, ended_at timestamptz, end_reason text, status text)
language sql stable set search_path = public as $$
  with latest as (
    select distinct on (s.entry_id) s.*
      from auth_sessions s
     where s.role = 'student' and s.created_at > now() - interval '24 hours'
     order by s.entry_id, s.created_at desc
  )
  select e.id, e.entry_number, e.team_name,
         (select string_agg(m.full_name, ', ' order by m.member_position) from team_members m where m.entry_id = e.id),
         e.present, l.created_at, l.last_seen_at, l.ended_at, l.end_reason,
         case
           when l.ended_at is not null then 'offline'
           when l.expires_at <= now() then 'offline'
           when l.last_seen_at > now() - make_interval(secs => p_online_seconds) and l.client_visible then 'online'
           when l.last_seen_at > now() - make_interval(secs => p_idle_seconds) then 'idle'
           else 'offline'
         end
    from latest l join entries e on e.id = l.entry_id
   order by e.entry_number
$$;

-- ---------------------------------------------------------------------
-- Participant import (atomic; idempotent on registration_id)
-- ---------------------------------------------------------------------
create or replace function import_participants(p_entries jsonb, p_admin uuid)
returns jsonb language plpgsql set search_path = public as $$
declare rec jsonb; v_max integer; v_first integer; v_imported integer := 0; v_skipped integer := 0; v_entry uuid; v_members integer;
begin
  perform pg_advisory_xact_lock(hashtext('import_participants'));
  select coalesce(max(entry_number), 0) into v_max from entries;

  for rec in select value from jsonb_array_elements(p_entries) loop
    if exists (select 1 from entries where registration_id = rec ->> 'registration_id') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_max := v_max + 1;
    v_first := coalesce(v_first, v_max);
    v_members := jsonb_array_length(rec -> 'members');
    insert into entries (entry_code, entry_number, registration_id, team_name, payment_status, is_team)
    values ('ENTRY-' || case when v_max < 1000 then lpad(v_max::text, 3, '0') else v_max::text end,
            v_max, rec ->> 'registration_id', nullif(rec ->> 'team_name', ''), 'paid', v_members > 1)
    returning id into v_entry;

    insert into team_members (entry_id, member_position, full_name, email, phone, gender, college, city, branch, study_year, source_row)
    select v_entry, m.position, m.full_name, nullif(m.email, ''), nullif(m.phone, ''), nullif(m.gender, ''),
           nullif(m.college, ''), nullif(m.city, ''), nullif(m.branch, ''), nullif(m.study_year, ''), m.source_row
      from jsonb_to_recordset(rec -> 'members') as m(
        position integer, full_name text, email text, phone text, gender text,
        college text, city text, branch text, study_year text, source_row integer);
    v_imported := v_imported + 1;
  end loop;

  insert into admin_actions (admin_id, action, new_value)
  values (p_admin, 'csv_import', jsonb_build_object('imported', v_imported, 'skipped_existing', v_skipped,
          'first_entry_number', v_first, 'last_entry_number', case when v_imported > 0 then v_max end));
  return jsonb_build_object('ok', true, 'imported', v_imported, 'skippedExisting', v_skipped,
                            'firstEntryNumber', v_first, 'lastEntryNumber', case when v_imported > 0 then v_max end);
end $$;

-- =====================================================================
-- Privileges: only the server (service_role) may call these functions or
-- touch the new tables. The browser's publishable key gets nothing.
-- =====================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('rate_limit_hit', 'auth_session_validate', '_student_session_ok', 'student_login',
                         '_round1_submit_entry', '_round1_finalize', 'round1_tick', '_round1_assign_missing', '_round1_assign_error',
                         'round1_control', 'student_round1_state', '_word_count', 'student_autosave',
                         'student_advance', 'claim_evaluation_jobs', 'compute_round1_results',
                         'admin_live_participants', 'import_participants', 'entries_fill_entry_number')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table auth_sessions, rate_limits from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table auth_sessions, rate_limits from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table auth_sessions, rate_limits to service_role;
  end if;
end $$;
