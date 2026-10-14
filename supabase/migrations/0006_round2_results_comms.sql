-- =====================================================================
-- 0006 — Round 2 (organizer-configured), results publication, targeted
-- announcements, schema health check, reset preview.
--
-- Additive and safe with the 0005 application code: new columns have
-- defaults, existing functions keep their signatures, and nothing that the
-- previous version reads is renamed or removed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Announcements: optional title and audience targeting
-- ---------------------------------------------------------------------
alter table announcements add column if not exists title text;
alter table announcements add column if not exists audience text not null default 'all';
alter table announcements add column if not exists entry_ids uuid[] not null default '{}';
alter table announcements add column if not exists updated_at timestamptz;
alter table announcements add column if not exists updated_by uuid references admins(id) on delete set null;
do $$ begin
  alter table announcements add constraint announcements_audience_check
    check (audience in ('all', 'checked_in', 'round2', 'entries'));
exception when duplicate_object then null; end $$;
create index if not exists idx_announcements_active on announcements(active, created_at desc);
-- The browser no longer reads Supabase directly; keep the old public read
-- policy (for the previous app version) but never expose targeted messages.
drop policy if exists "public read active announcements" on announcements;
create policy "public read active announcements" on announcements
  for select using (active = true and audience = 'all');

-- ---------------------------------------------------------------------
-- Results publication settings (nothing is visible to students until an
-- admin publishes it).
-- ---------------------------------------------------------------------
insert into event_settings (key, value) values ('results_publication', jsonb_build_object(
  'round1', jsonb_build_object('published', false, 'showScore', true, 'showRank', true, 'showQualification', true,
                               'showFeedback', false, 'showLeaderboard', false, 'leaderboardSize', 10),
  'final',  jsonb_build_object('published', false, 'showScore', true, 'showRank', true,
                               'showFeedback', false, 'showLeaderboard', false, 'leaderboardSize', 10)))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Round 2 schema
-- ---------------------------------------------------------------------
insert into rounds (round_number, status, config) values (2, 'not_started', '{}'::jsonb)
on conflict (round_number) do nothing;

alter table round2_problems add column if not exists problem_code text;
alter table round2_problems add column if not exists instructions text;
alter table round2_problems add column if not exists constraints text;
alter table round2_problems add column if not exists expected_output text;
alter table round2_problems add column if not exists evaluation_criteria text;
alter table round2_problems add column if not exists updated_at timestamptz not null default now();
alter table round2_problems add column if not exists updated_by uuid references admins(id) on delete set null;
create unique index if not exists round2_problems_code_key on round2_problems(upper(problem_code)) where problem_code is not null;

alter table surprise_twists add column if not exists created_at timestamptz not null default now();
alter table surprise_twists add column if not exists updated_at timestamptz not null default now();

alter table round2_assignments add column if not exists problem_snapshot jsonb;

alter table round2_states add column if not exists started_at timestamptz;
alter table round2_states add column if not exists initial_submitted_at timestamptz;
alter table round2_states add column if not exists last_saved_at timestamptz;
alter table round2_states add column if not exists twist_snapshot jsonb;
alter table round2_states add column if not exists submission_ref text;
alter table round2_states add column if not exists auto_submitted boolean not null default false;

alter table judge_questions add column if not exists admin_id uuid references admins(id) on delete set null;

alter table round2_ai_evaluations add column if not exists model text;
alter table round2_ai_evaluations add column if not exists rubric_version text;

create table if not exists round2_qualifiers (
  entry_id uuid primary key references entries(id) on delete cascade,
  source text not null check (source in ('round1', 'manual')),
  round1_rank integer,
  round1_score numeric(6,1),
  added_by uuid references admins(id) on delete set null,
  added_at timestamptz not null default now()
);
alter table round2_qualifiers enable row level security;

create table if not exists round2_eval_jobs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references entries(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  retry_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  queued_at timestamptz not null default now(),
  evaluated_at timestamptz
);
create index if not exists idx_round2_eval_jobs_claim on round2_eval_jobs(status, next_attempt_at);
alter table round2_eval_jobs enable row level security;

-- Admin overrides of a finalist's Round 2 score (never edits jury/AI rows).
create table if not exists round2_reviews (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  reviewer_id uuid references admins(id) on delete set null,
  old_score numeric(6,1),
  new_score numeric(6,1) not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_round2_reviews_entry on round2_reviews(entry_id, created_at desc);
alter table round2_reviews enable row level security;

alter table final_results add column if not exists round2_jury numeric(6,1);
alter table final_results add column if not exists round2_ai numeric(6,1);
alter table final_results add column if not exists computed_by uuid references admins(id) on delete set null;

-- ---------------------------------------------------------------------
-- Round 2 configuration. Defaults are deliberately "unconfirmed": the
-- round cannot start until an admin reviews and saves the configuration.
-- ---------------------------------------------------------------------
create or replace function _round2_default_config()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'confirmed', false,
    'durationMinutes', 45,
    'problemMode', 'common',            -- common | random
    'commonProblemId', null,
    'twist', jsonb_build_object('enabled', false, 'mode', 'common', 'commonTwistId', null),
    'jury', jsonb_build_object('enabled', true, 'criteria', jsonb_build_array(
        jsonb_build_object('key', 'understanding', 'label', 'Problem understanding', 'max', 10),
        jsonb_build_object('key', 'response_quality', 'label', 'Response quality', 'max', 10),
        jsonb_build_object('key', 'adaptability', 'label', 'Adaptability', 'max', 10),
        jsonb_build_object('key', 'interaction', 'label', 'Jury interaction', 'max', 10))),
    'ai', jsonb_build_object('enabled', false, 'maxPoints', 60),
    'limits', jsonb_build_object('promptWords', 400, 'outputChars', 8000, 'rationaleWords', 300),
    'final', jsonb_build_object('round1Weight', 1, 'round2Weight', 1)
  )
$$;

create or replace function _round2_config()
returns jsonb language sql stable set search_path = public as $$
  select _round2_default_config() || coalesce((select config from rounds where round_number = 2), '{}'::jsonb)
$$;

create or replace function _round2_jury_max(p_cfg jsonb)
returns numeric language sql immutable set search_path = public as $$
  select coalesce(sum((c ->> 'max')::numeric), 0)
    from jsonb_array_elements(case when coalesce((p_cfg -> 'jury' ->> 'enabled')::boolean, false)
                                   then coalesce(p_cfg -> 'jury' -> 'criteria', '[]'::jsonb) else '[]'::jsonb end) c
$$;

create or replace function _round2_problem_snapshot(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', p.id, 'problem_code', p.problem_code, 'title', p.title,
           'problem_statement', p.problem_statement, 'instructions', p.instructions, 'constraints', p.constraints,
           'expected_output', p.expected_output, 'evaluation_criteria', p.evaluation_criteria)
    from round2_problems p where p.id = p_id
$$;

create or replace function _round2_twist_snapshot(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', t.id, 'title', t.title, 'description', t.description)
    from surprise_twists t where t.id = p_id
$$;

-- Saves the configuration (validated) while Round 2 is not running.
create or replace function round2_save_config(p_admin uuid, p_config jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_cfg jsonb; v_old jsonb; v_c jsonb; v_keys text[] := array['understanding', 'response_quality', 'adaptability', 'interaction'];
begin
  select * into r from rounds where round_number = 2 for update;
  if r.status in ('running', 'paused') then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_active', 'message', 'Round 2 is running or paused; its configuration is locked.');
  end if;
  v_old := _round2_config();
  v_cfg := _round2_default_config() || coalesce(p_config, '{}'::jsonb);

  if coalesce((v_cfg ->> 'durationMinutes')::integer, 0) not between 5 and 240 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Duration must be between 5 and 240 minutes.');
  end if;
  if v_cfg ->> 'problemMode' not in ('common', 'random') then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Problem mode must be common or random.');
  end if;
  if coalesce(v_cfg -> 'twist' ->> 'mode', 'common') not in ('common', 'random') then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Twist mode must be common or random.');
  end if;
  if jsonb_typeof(v_cfg -> 'jury' -> 'criteria') <> 'array' or jsonb_array_length(v_cfg -> 'jury' -> 'criteria') <> 4 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Jury criteria must list the four scoring fields.');
  end if;
  for v_c in select * from jsonb_array_elements(v_cfg -> 'jury' -> 'criteria') loop
    if not (v_c ->> 'key' = any (v_keys)) or coalesce(trim(v_c ->> 'label'), '') = ''
       or coalesce((v_c ->> 'max')::numeric, -1) not between 0 and 100 then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Each jury criterion needs a label and a maximum between 0 and 100.');
    end if;
  end loop;
  if coalesce((v_cfg -> 'ai' ->> 'maxPoints')::numeric, -1) not between 0 and 200 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'AI points must be between 0 and 200.');
  end if;
  if coalesce((v_cfg -> 'final' ->> 'round1Weight')::numeric, -1) not between 0 and 10
     or coalesce((v_cfg -> 'final' ->> 'round2Weight')::numeric, -1) not between 0 and 10 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Weights must be between 0 and 10.');
  end if;
  if coalesce((v_cfg -> 'limits' ->> 'promptWords')::integer, 0) not between 20 and 5000
     or coalesce((v_cfg -> 'limits' ->> 'outputChars')::integer, 0) not between 100 and 50000
     or coalesce((v_cfg -> 'limits' ->> 'rationaleWords')::integer, -1) not between 0 and 3000 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Answer limits are out of range.');
  end if;
  if not coalesce((v_cfg -> 'jury' ->> 'enabled')::boolean, false) and not coalesce((v_cfg -> 'ai' ->> 'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid', 'message', 'Enable jury scoring, AI scoring or both — otherwise Round 2 has no score.');
  end if;

  v_cfg := v_cfg || jsonb_build_object('confirmed', true, 'savedAt', now(), 'savedBy', p_admin);
  update rounds set config = v_cfg where id = r.id;
  insert into admin_actions (admin_id, action, old_value, new_value) values (p_admin, 'round2_config', v_old, v_cfg);
  return jsonb_build_object('ok', true, 'config', v_cfg);
end $$;

-- ---------------------------------------------------------------------
-- Qualifiers
-- ---------------------------------------------------------------------
create or replace function round2_set_qualifiers(p_admin uuid, p_action text, p_entries uuid[] default '{}')
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; r1 rounds; v_count integer := 0; v_assigned integer := 0;
begin
  select * into r from rounds where round_number = 2 for update;
  if p_action in ('from_round1', 'remove', 'clear') and r.status <> 'not_started' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_started',
      'message', 'Round 2 has started; finalists can only be added now (Start over Round 2 to change the list).');
  end if;
  if p_action = 'from_round1' then
    select * into r1 from rounds where round_number = 1;
    if not exists (select 1 from round_results where round_id = r1.id) then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'no_results', 'message', 'Compute Round 1 results first.');
    end if;
    delete from round2_qualifiers where source = 'round1';
    insert into round2_qualifiers (entry_id, source, round1_rank, round1_score, added_by)
    select rr.entry_id, 'round1', rr.rank, rr.score, p_admin
      from round_results rr join entries e on e.id = rr.entry_id
     where rr.round_id = r1.id and rr.qualified and not e.disqualified
    on conflict (entry_id) do update set source = 'round1', round1_rank = excluded.round1_rank, round1_score = excluded.round1_score;
    get diagnostics v_count = row_count;
  elsif p_action = 'add' then
    insert into round2_qualifiers (entry_id, source, round1_rank, round1_score, added_by)
    select e.id, 'manual', rr.rank, rr.score, p_admin
      from entries e
      left join rounds r1x on r1x.round_number = 1
      left join round_results rr on rr.entry_id = e.id and rr.round_id = r1x.id
     where e.id = any (p_entries) and not e.disqualified
    on conflict (entry_id) do nothing;
    get diagnostics v_count = row_count;
    if r.status in ('running', 'paused') then v_assigned := _round2_assign(r.id); end if;
  elsif p_action = 'remove' then
    delete from round2_qualifiers where entry_id = any (p_entries);
    get diagnostics v_count = row_count;
  elsif p_action = 'clear' then
    delete from round2_qualifiers;
    get diagnostics v_count = row_count;
  else
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_action', 'message', 'Unknown action.');
  end if;
  insert into admin_actions (admin_id, action, new_value)
  values (p_admin, 'round2_qualifiers_' || p_action, jsonb_build_object('count', v_count, 'entries', to_jsonb(p_entries), 'assigned', v_assigned));
  return jsonb_build_object('ok', true, 'changed', v_count, 'assigned', v_assigned,
                            'total', (select count(*) from round2_qualifiers));
end $$;

-- ---------------------------------------------------------------------
-- Preflight
-- ---------------------------------------------------------------------
create or replace function round2_preflight()
returns jsonb language plpgsql stable set search_path = public as $$
declare v_cfg jsonb := _round2_config(); v_errors text[] := '{}'; v_warnings text[] := '{}';
  v_q integer; v_q_absent integer; v_q_dq integer; v_problems integer; v_twists integer; v_judges integer; v_p round2_problems; v_t surprise_twists;
begin
  if not coalesce((v_cfg ->> 'confirmed')::boolean, false) then
    v_errors := v_errors || 'Round 2 settings have not been reviewed and saved yet.'::text;
  end if;
  select count(*) into v_q from round2_qualifiers;
  select count(*) into v_q_absent from round2_qualifiers q join entries e on e.id = q.entry_id where not e.present;
  select count(*) into v_q_dq from round2_qualifiers q join entries e on e.id = q.entry_id where e.disqualified;
  select count(*) into v_problems from round2_problems where active;
  select count(*) into v_twists from surprise_twists where active;
  select count(*) into v_judges from judges where active;

  if v_q = 0 then v_errors := v_errors || 'No finalists selected (Round 2 → Finalists).'::text; end if;
  if v_q_dq > 0 then v_warnings := v_warnings || format('%s finalist(s) are disqualified and will be skipped.', v_q_dq); end if;
  if v_q_absent > 0 then v_warnings := v_warnings || format('%s finalist(s) are not checked in and cannot sign in.', v_q_absent); end if;

  if v_cfg ->> 'problemMode' = 'common' then
    select * into v_p from round2_problems where id = nullif(v_cfg ->> 'commonProblemId', '')::uuid;
    if not found then v_errors := v_errors || 'Choose the common Round 2 problem.'::text;
    elsif not v_p.active then v_errors := v_errors || 'The chosen Round 2 problem is disabled.'::text; end if;
  elsif v_problems = 0 then
    v_errors := v_errors || 'Add at least one active Round 2 problem.'::text;
  end if;

  if coalesce((v_cfg -> 'twist' ->> 'enabled')::boolean, false) then
    if v_cfg -> 'twist' ->> 'mode' = 'common' then
      select * into v_t from surprise_twists where id = nullif(v_cfg -> 'twist' ->> 'commonTwistId', '')::uuid;
      if not found or not v_t.active then v_errors := v_errors || 'Choose an active surprise twist (or disable twists).'::text; end if;
    elsif v_twists = 0 then
      v_errors := v_errors || 'Add at least one active surprise twist (or disable twists).'::text;
    end if;
  end if;
  if coalesce((v_cfg -> 'jury' ->> 'enabled')::boolean, false) and v_judges = 0 then
    v_warnings := v_warnings || 'Jury scoring is on but there are no active judge accounts.'::text;
  end if;

  return jsonb_build_object('ok', coalesce(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(v_errors), 'warnings', to_jsonb(v_warnings),
    'finalists', v_q, 'activeProblems', v_problems, 'activeTwists', v_twists, 'activeJudges', v_judges,
    'juryMax', _round2_jury_max(v_cfg), 'config', v_cfg);
end $$;

-- ---------------------------------------------------------------------
-- Assignment + lifecycle
-- ---------------------------------------------------------------------
create or replace function _round2_assign(p_round uuid)
returns integer language plpgsql set search_path = public as $$
declare v_cfg jsonb := _round2_config(); r rounds; q record; v_problem uuid; v_count integer := 0; v_twist_on boolean;
begin
  select * into r from rounds where id = p_round;
  v_twist_on := coalesce((v_cfg -> 'twist' ->> 'enabled')::boolean, false);
  for q in
    select qf.entry_id from round2_qualifiers qf join entries e on e.id = qf.entry_id
     where not e.disqualified and not exists (select 1 from round2_assignments a where a.entry_id = qf.entry_id)
     order by random()
  loop
    if v_cfg ->> 'problemMode' = 'common' then
      v_problem := nullif(v_cfg ->> 'commonProblemId', '')::uuid;
    else
      select p.id into v_problem from round2_problems p
       where p.active
       order by (select count(*) from round2_assignments a where a.problem_id = p.id), random()
       limit 1;
    end if;
    if v_problem is null then return -1; end if;
    insert into round2_assignments (entry_id, problem_id, problem_snapshot)
    values (q.entry_id, v_problem, _round2_problem_snapshot(v_problem));
    insert into round2_states (entry_id, state, started_at)
    values (q.entry_id,
            case when r.status in ('running', 'paused') then (case when v_twist_on then 'INITIAL_PROMPT' else 'REFINEMENT' end) else 'R2_WAITING' end,
            case when r.status in ('running', 'paused') then now() end)
    on conflict (entry_id) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Locks one finalist's work as final (used by submit, stop and auto-end).
create or replace function _round2_finalize_entry(p_entry uuid, p_reason text)
returns text language plpgsql set search_path = public as $$
declare s round2_states; v_ref text; v_number integer; v_cfg jsonb := _round2_config();
begin
  select * into s from round2_states where entry_id = p_entry for update;
  if not found then return null; end if;
  if s.state in ('FINAL_SUBMISSION', 'EVALUATION', 'RESULT') then return s.submission_ref; end if;
  select entry_number into v_number from entries where id = p_entry;
  v_ref := coalesce(s.submission_ref, 'R2-' || v_number || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5)));
  update round2_states set
      final_prompt = coalesce(nullif(final_prompt, ''), initial_prompt),
      final_output = coalesce(nullif(final_output, ''), initial_output),
      initial_submitted_at = coalesce(initial_submitted_at, now()),
      final_submitted_at = now(), state = 'FINAL_SUBMISSION', submission_ref = v_ref,
      auto_submitted = (p_reason <> 'student_submit'), updated_at = now()
   where entry_id = p_entry;
  if coalesce((v_cfg -> 'ai' ->> 'enabled')::boolean, false) then
    insert into round2_eval_jobs (entry_id) values (p_entry) on conflict (entry_id) do nothing;
  end if;
  insert into activity_logs (entry_id, event_type, metadata)
  values (p_entry, 'submission', jsonb_build_object('round', 2, 'submission_ref', v_ref, 'reason', p_reason));
  return v_ref;
end $$;

create or replace function _round2_finalize_all(p_reason text)
returns integer language plpgsql set search_path = public as $$
declare q record; v_n integer := 0;
begin
  for q in select entry_id from round2_states where state not in ('FINAL_SUBMISSION', 'EVALUATION', 'RESULT') loop
    perform _round2_finalize_entry(q.entry_id, p_reason);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function round2_tick()
returns text language plpgsql set search_path = public as $$
declare r rounds;
begin
  select * into r from rounds where round_number = 2;
  if not found then return 'missing'; end if;
  if r.status <> 'running' or r.round_end_at is null or r.round_end_at > now() - interval '20 seconds' then
    return r.status;
  end if;
  select * into r from rounds where id = r.id for update;
  if r.status = 'running' and r.round_end_at <= now() - interval '20 seconds' then
    update rounds set status = 'ended' where id = r.id;
    perform _round2_finalize_all('round_time_up');
    insert into admin_actions (action, old_value, new_value)
    values ('auto_end_round2', jsonb_build_object('status', 'running'), jsonb_build_object('status', 'ended', 'round_end_at', r.round_end_at));
    update announcements set active = false where active and message like 'Round 2%';
    insert into announcements (message, active, audience) values ('Round 2 time is up. All work has been submitted.', true, 'round2');
    return 'ended';
  end if;
  return r.status;
end $$;

create or replace function round2_control(p_action text, p_admin uuid, p_confirm text default null)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_cfg jsonb; v_pre jsonb; v_n integer; v_delta interval; v_twist uuid; s record;
begin
  perform round2_tick();
  select * into r from rounds where round_number = 2 for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'round_missing', 'message', 'Round 2 is not configured.');
  end if;
  v_cfg := _round2_config();

  if p_action = 'start' then
    if r.status <> 'not_started' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Round 2 is ' || r.status || '. Start over Round 2 before starting again.');
    end if;
    if (select status from rounds where round_number = 1) in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'round1_active', 'message', 'Round 1 is still running. Stop it first.');
    end if;
    v_pre := round2_preflight();
    if not (v_pre ->> 'ok')::boolean then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'preflight_failed', 'message', v_pre -> 'errors' ->> 0, 'preflight', v_pre);
    end if;
    update rounds set status = 'running', round_start_at = now(),
           round_end_at = now() + make_interval(mins => (v_cfg ->> 'durationMinutes')::integer),
           paused_at = null, total_paused_seconds = 0
     where id = r.id;
    -- Rows created before the start (R2_WAITING) move to the first working state.
    v_n := _round2_assign(r.id);
    if v_n < 0 then raise exception 'ROUND2_NO_PROBLEM'; end if;
    update round2_states set state = case when coalesce((v_cfg -> 'twist' ->> 'enabled')::boolean, false) then 'INITIAL_PROMPT' else 'REFINEMENT' end,
           started_at = now(), updated_at = now()
     where state = 'R2_WAITING';
    insert into admin_actions (admin_id, action, new_value)
    values (p_admin, 'start_round2', jsonb_build_object('assigned', (select count(*) from round2_assignments), 'config', v_cfg));
    update announcements set active = false where active and message like 'Round 2%';
    insert into announcements (message, active, created_by, audience) values ('Round 2 has started!', true, p_admin, 'round2');
    return jsonb_build_object('ok', true, 'roundStatus', 'running', 'assigned', (select count(*) from round2_assignments), 'warnings', v_pre -> 'warnings');

  elsif p_action = 'pause' then
    if r.status <> 'running' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Round 2 is ' || r.status || '; only a running round can be paused.');
    end if;
    update rounds set status = 'paused', paused_at = now() where id = r.id;
    insert into admin_actions (admin_id, action) values (p_admin, 'pause_round2');
    update announcements set active = false where active and message like 'Round 2%';
    insert into announcements (message, active, created_by, audience) values ('Round 2 is paused. The timer is frozen.', true, p_admin, 'round2');
    return jsonb_build_object('ok', true, 'roundStatus', 'paused');

  elsif p_action = 'resume' then
    if r.status <> 'paused' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Round 2 is ' || r.status || '; only a paused round can be resumed.');
    end if;
    v_delta := now() - coalesce(r.paused_at, now());
    update rounds set status = 'running', paused_at = null, round_end_at = round_end_at + v_delta,
           total_paused_seconds = total_paused_seconds + ceil(extract(epoch from v_delta))::integer
     where id = r.id;
    insert into admin_actions (admin_id, action, new_value) values (p_admin, 'resume_round2', jsonb_build_object('paused_seconds', ceil(extract(epoch from v_delta))));
    update announcements set active = false where active and message like 'Round 2%';
    insert into announcements (message, active, created_by, audience) values ('Round 2 has resumed.', true, p_admin, 'round2');
    return jsonb_build_object('ok', true, 'roundStatus', 'running', 'pausedSeconds', ceil(extract(epoch from v_delta)));

  elsif p_action = 'reveal_twist' then
    if r.status not in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Twists can only be revealed while Round 2 is running or paused.');
    end if;
    if not coalesce((v_cfg -> 'twist' ->> 'enabled')::boolean, false) then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'twist_disabled', 'message', 'Surprise twists are disabled in the Round 2 settings.');
    end if;
    v_n := 0;
    for s in select entry_id from round2_states where state in ('INITIAL_PROMPT', 'OUTPUT', 'R2_STARTED', 'JURY_PHASE') for update loop
      if v_cfg -> 'twist' ->> 'mode' = 'common' then
        v_twist := nullif(v_cfg -> 'twist' ->> 'commonTwistId', '')::uuid;
      else
        select t.id into v_twist from surprise_twists t where t.active
         order by (select count(*) from round2_states x where x.twist_id = t.id), random() limit 1;
      end if;
      if v_twist is null then
        return jsonb_build_object('ok', false, 'status', 409, 'code', 'no_twist', 'message', 'No active surprise twist is available.');
      end if;
      update round2_states set twist_id = v_twist, twist_snapshot = _round2_twist_snapshot(v_twist), twist_revealed_at = now(),
             initial_submitted_at = coalesce(initial_submitted_at, now()),
             final_prompt = coalesce(final_prompt, initial_prompt), final_output = coalesce(final_output, initial_output),
             state = 'SURPRISE_REVEALED', updated_at = now()
       where entry_id = s.entry_id;
      v_n := v_n + 1;
    end loop;
    insert into admin_actions (admin_id, action, new_value) values (p_admin, 'reveal_twist_round2', jsonb_build_object('revealed', v_n));
    insert into announcements (message, active, created_by, audience) values ('Round 2: the surprise twist is live — check your screen.', true, p_admin, 'round2');
    return jsonb_build_object('ok', true, 'roundStatus', r.status, 'revealed', v_n);

  elsif p_action = 'stop' then
    if r.status not in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Round 2 must be running or paused to stop it.');
    end if;
    update rounds set status = 'ended', round_end_at = now(), paused_at = null where id = r.id;
    v_n := _round2_finalize_all('stopped_by_admin');
    insert into admin_actions (admin_id, action, new_value) values (p_admin, 'stop_round2', jsonb_build_object('finalized', v_n));
    update announcements set active = false where active and message like 'Round 2%';
    insert into announcements (message, active, created_by, audience) values ('Round 2 has ended. All work has been submitted.', true, p_admin, 'round2');
    return jsonb_build_object('ok', true, 'roundStatus', 'ended', 'entriesFinalized', v_n);

  elsif p_action = 'reset' then
    if coalesce(p_confirm, '') <> 'START OVER' then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'confirmation_required', 'message', 'Type START OVER to confirm.');
    end if;
    if r.status in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Stop Round 2 before starting over.');
    end if;
    select count(*) into v_n from round2_states;
    delete from round2_eval_jobs; delete from round2_ai_evaluations; delete from round2_reviews;
    delete from judge_scores; delete from judge_questions; delete from round2_states; delete from round2_assignments;
    delete from final_results;
    update rounds set status = 'not_started', round_start_at = null, round_end_at = null, paused_at = null, total_paused_seconds = 0 where id = r.id;
    update event_settings set value = jsonb_set(value, '{final,published}', 'false'::jsonb), updated_at = now() where key = 'results_publication';
    update announcements set active = false where active and message like 'Round 2%';
    insert into admin_actions (admin_id, action, reason, old_value, new_value)
    values (p_admin, 'reset_round2', 'Start Over confirmed by admin', jsonb_build_object('status', r.status, 'teams', v_n), jsonb_build_object('status', 'not_started'));
    return jsonb_build_object('ok', true, 'roundStatus', 'not_started', 'teamsCleared', v_n);
  end if;
  return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_action', 'message', 'Unknown action.');
end $$;

-- Round 1 "Start over" for one round, refused once Round 2 has begun.
create or replace function round1_start_over(p_admin uuid, p_confirm text)
returns jsonb language plpgsql set search_path = public as $$
declare v jsonb;
begin
  perform 1 from rounds order by round_number for update;
  if (select status from rounds where round_number = 2) <> 'not_started' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round2_started',
      'message', 'Round 2 has already started. Use Reset Competition Data to clear both rounds.');
  end if;
  v := round1_control('reset', p_admin, p_confirm);
  if (v ->> 'ok')::boolean then
    delete from round2_qualifiers where source = 'round1';
    update event_settings set value = jsonb_set(value, '{round1,published}', 'false'::jsonb), updated_at = now() where key = 'results_publication';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Student side (session-checked in SQL like Round 1)
-- ---------------------------------------------------------------------
create or replace function student_round2_state(p_sid uuid, p_entry uuid)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_cfg jsonb; s round2_states; a round2_assignments; v_q jsonb; v_snap jsonb;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session_invalid');
  end if;
  perform round2_tick();
  select * into r from rounds where round_number = 2;
  v_cfg := _round2_config();
  if not exists (select 1 from round2_qualifiers where entry_id = p_entry) then
    return jsonb_build_object('ok', true, 'eligible', false, 'roundStatus', r.status, 'serverNow', now());
  end if;
  select * into s from round2_states where entry_id = p_entry;
  select * into a from round2_assignments where entry_id = p_entry;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'answer', q.answer,
           'askedAt', q.asked_at, 'answeredAt', q.answered_at) order by q.asked_at), '[]'::jsonb)
    into v_q from judge_questions q where q.entry_id = p_entry;
  v_snap := a.problem_snapshot;
  return jsonb_build_object('ok', true, 'eligible', true, 'serverNow', now(),
    'roundStatus', r.status, 'roundStartAt', r.round_start_at, 'roundEndAt', r.round_end_at, 'pausedAt', r.paused_at,
    'state', coalesce(s.state, 'R2_WAITING'),
    'twistEnabled', coalesce((v_cfg -> 'twist' ->> 'enabled')::boolean, false),
    'limits', v_cfg -> 'limits',
    -- Students never receive the expected output or the judging criteria.
    'problem', case when r.status = 'not_started' or v_snap is null then null else jsonb_build_object(
        'code', v_snap ->> 'problem_code', 'title', v_snap ->> 'title', 'statement', v_snap ->> 'problem_statement',
        'instructions', v_snap ->> 'instructions', 'constraints', v_snap ->> 'constraints') end,
    'twist', case when s.twist_revealed_at is null then null else jsonb_build_object(
        'title', s.twist_snapshot ->> 'title', 'description', s.twist_snapshot ->> 'description', 'revealedAt', s.twist_revealed_at) end,
    'initialPrompt', s.initial_prompt, 'initialOutput', s.initial_output,
    'finalPrompt', s.final_prompt, 'finalOutput', s.final_output, 'rationale', s.rationale,
    'initialSubmittedAt', s.initial_submitted_at, 'finalSubmittedAt', s.final_submitted_at,
    'lastSavedAt', s.last_saved_at, 'submissionRef', s.submission_ref,
    'questions', v_q);
end $$;

create or replace function student_round2_save(p_sid uuid, p_entry uuid, p_action text, p_fields jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_cfg jsonb; s round2_states; v_limits jsonb; v_ref text; v_prompt text; v_output text; v_rationale text;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session_invalid');
  end if;
  if p_action not in ('save', 'submit_initial', 'submit_final') then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_action');
  end if;
  perform round2_tick();
  select * into r from rounds where round_number = 2;
  if r.status = 'paused' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_paused', 'message', 'Round 2 is paused.');
  end if;
  if r.status <> 'running' or now() > r.round_end_at + interval '15 seconds' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_closed', 'message', 'Round 2 is closed.');
  end if;
  select * into s from round2_states where entry_id = p_entry for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'not_finalist', 'message', 'Your team is not in Round 2.');
  end if;
  v_cfg := _round2_config();
  v_limits := v_cfg -> 'limits';

  if s.state in ('FINAL_SUBMISSION', 'EVALUATION', 'RESULT') then
    if p_action = 'submit_final' then
      return jsonb_build_object('ok', true, 'state', s.state, 'submissionRef', s.submission_ref, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'already_submitted', 'message', 'Your final answer is already submitted.');
  end if;

  if s.state = 'INITIAL_PROMPT' then
    if p_action = 'submit_final' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'wrong_stage', 'message', 'Submit your first attempt before the final answer.');
    end if;
    v_prompt := left(coalesce(p_fields ->> 'initialPrompt', s.initial_prompt, ''), 60000);
    v_output := left(coalesce(p_fields ->> 'initialOutput', s.initial_output, ''), 60000);
    if _word_count(v_prompt) > (v_limits ->> 'promptWords')::integer then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'too_long', 'message', 'Prompt is over the word limit.');
    end if;
    if length(v_output) > (v_limits ->> 'outputChars')::integer then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'too_long', 'message', 'AI output is over the character limit.');
    end if;
    if p_action = 'submit_initial' and trim(v_prompt) = '' then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'empty', 'message', 'Write your prompt before submitting.');
    end if;
    update round2_states set initial_prompt = v_prompt, initial_output = v_output, last_saved_at = now(), updated_at = now(),
           state = case when p_action = 'submit_initial' then 'OUTPUT' else state end,
           initial_submitted_at = case when p_action = 'submit_initial' then now() else initial_submitted_at end
     where entry_id = p_entry;
    return jsonb_build_object('ok', true, 'state', case when p_action = 'submit_initial' then 'OUTPUT' else s.state end, 'savedAt', now());
  end if;

  if s.state in ('OUTPUT', 'R2_WAITING', 'R2_STARTED', 'JURY_PHASE') then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'waiting_for_twist', 'message', 'Your first attempt is locked. Wait for the next stage.');
  end if;

  -- SURPRISE_REVEALED / REFINEMENT: final prompt, output and rationale.
  if p_action = 'submit_initial' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'wrong_stage', 'message', 'This stage has already moved on.');
  end if;
  v_prompt := left(coalesce(p_fields ->> 'finalPrompt', s.final_prompt, ''), 60000);
  v_output := left(coalesce(p_fields ->> 'finalOutput', s.final_output, ''), 60000);
  v_rationale := left(coalesce(p_fields ->> 'rationale', s.rationale, ''), 30000);
  if _word_count(v_prompt) > (v_limits ->> 'promptWords')::integer then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'too_long', 'message', 'Prompt is over the word limit.');
  end if;
  if length(v_output) > (v_limits ->> 'outputChars')::integer then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'too_long', 'message', 'AI output is over the character limit.');
  end if;
  if _word_count(v_rationale) > (v_limits ->> 'rationaleWords')::integer then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'too_long', 'message', 'Explanation is over the word limit.');
  end if;
  if p_action = 'submit_final' and trim(v_prompt) = '' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'empty', 'message', 'Write your final prompt before submitting.');
  end if;
  update round2_states set final_prompt = v_prompt, final_output = v_output, rationale = v_rationale,
         last_saved_at = now(), updated_at = now(), state = 'REFINEMENT'
   where entry_id = p_entry;
  if p_action = 'submit_final' then
    v_ref := _round2_finalize_entry(p_entry, 'student_submit');
    return jsonb_build_object('ok', true, 'state', 'FINAL_SUBMISSION', 'submissionRef', v_ref);
  end if;
  return jsonb_build_object('ok', true, 'state', 'REFINEMENT', 'savedAt', now());
end $$;

create or replace function student_round2_answer(p_sid uuid, p_entry uuid, p_question uuid, p_answer text)
returns jsonb language plpgsql set search_path = public as $$
declare q judge_questions; r rounds;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session_invalid');
  end if;
  select * into r from rounds where round_number = 2;
  if r.status not in ('running', 'paused') then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_closed', 'message', 'Answers can only be sent while Round 2 is open.');
  end if;
  select * into q from judge_questions where id = p_question and entry_id = p_entry for update;
  if not found then return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found'); end if;
  if trim(coalesce(p_answer, '')) = '' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'empty', 'message', 'Write an answer first.');
  end if;
  update judge_questions set answer = left(p_answer, 4000), answered_at = now() where id = p_question;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Jury
-- ---------------------------------------------------------------------
create or replace function jury_ask_question(p_judge uuid, p_admin uuid, p_entry uuid, p_question text)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_id uuid;
begin
  select * into r from rounds where round_number = 2;
  if r.status not in ('running', 'paused') then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_closed', 'message', 'Questions can only be asked while Round 2 is running or paused.');
  end if;
  if not exists (select 1 from round2_states where entry_id = p_entry) then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_finalist', 'message', 'That team is not in Round 2.');
  end if;
  if trim(coalesce(p_question, '')) = '' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'empty', 'message', 'Write a question first.');
  end if;
  insert into judge_questions (entry_id, judge_id, admin_id, question) values (p_entry, p_judge, p_admin, left(p_question, 2000))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function jury_save_score(p_judge uuid, p_entry uuid, p_scores jsonb, p_notes text, p_lock boolean)
returns jsonb language plpgsql set search_path = public as $$
declare v_cfg jsonb := _round2_config(); c jsonb; v_val numeric; v_total numeric := 0; cur judge_scores; v_vals jsonb := '{}'::jsonb;
begin
  if not coalesce((v_cfg -> 'jury' ->> 'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'jury_disabled', 'message', 'Jury scoring is disabled in the Round 2 settings.');
  end if;
  if not exists (select 1 from round2_states where entry_id = p_entry) then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_finalist', 'message', 'That team is not in Round 2.');
  end if;
  if (select status from rounds where round_number = 2) = 'not_started' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'not_started', 'message', 'Round 2 has not started.');
  end if;
  select * into cur from judge_scores where entry_id = p_entry and judge_id = p_judge for update;
  if found and cur.locked then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'locked', 'message', 'This score is locked. Ask an admin to unlock it.');
  end if;
  for c in select * from jsonb_array_elements(v_cfg -> 'jury' -> 'criteria') loop
    v_val := coalesce((p_scores ->> (c ->> 'key'))::numeric, 0);
    if v_val < 0 or v_val > (c ->> 'max')::numeric then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'out_of_range',
        'message', format('%s must be between 0 and %s.', c ->> 'label', c ->> 'max'));
    end if;
    v_val := round(v_val, 1);
    v_vals := v_vals || jsonb_build_object(c ->> 'key', v_val);
    v_total := v_total + v_val;
  end loop;
  insert into judge_scores (entry_id, judge_id, understanding, response_quality, adaptability, interaction, total, notes, locked, saved_at)
  values (p_entry, p_judge, (v_vals ->> 'understanding')::numeric, (v_vals ->> 'response_quality')::numeric,
          (v_vals ->> 'adaptability')::numeric, (v_vals ->> 'interaction')::numeric, v_total, left(p_notes, 4000), coalesce(p_lock, false), now())
  on conflict (entry_id, judge_id) do update set
    understanding = excluded.understanding, response_quality = excluded.response_quality,
    adaptability = excluded.adaptability, interaction = excluded.interaction, total = excluded.total,
    notes = excluded.notes, locked = excluded.locked, saved_at = now();
  return jsonb_build_object('ok', true, 'total', v_total, 'locked', coalesce(p_lock, false));
end $$;

create or replace function jury_unlock_score(p_admin uuid, p_entry uuid, p_judge uuid)
returns jsonb language plpgsql set search_path = public as $$
begin
  update judge_scores set locked = false where entry_id = p_entry and judge_id = p_judge and locked;
  if not found then return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found', 'message', 'No locked score found.'); end if;
  insert into admin_actions (admin_id, entry_id, action, new_value) values (p_admin, p_entry, 'unlock_jury_score', jsonb_build_object('judge_id', p_judge));
  return jsonb_build_object('ok', true);
end $$;

-- AI evaluation queue for Round 2 (same exactly-once claiming as Round 1).
create or replace function claim_round2_eval_jobs(p_limit integer, p_max_retries integer default 4, p_stale_seconds integer default 180)
returns setof round2_eval_jobs language plpgsql set search_path = public as $$
begin
  update round2_eval_jobs set status = 'queued', locked_at = null
   where status = 'processing' and locked_at < now() - make_interval(secs => p_stale_seconds);
  return query
  update round2_eval_jobs j set status = 'processing', locked_at = now()
   where j.id in (
     select id from round2_eval_jobs
      where status = 'queued' and next_attempt_at <= now() and retry_count <= p_max_retries
      order by queued_at
      limit p_limit
      for update skip locked)
  returning j.*;
end $$;

-- ---------------------------------------------------------------------
-- Final results
-- ---------------------------------------------------------------------
create or replace function compute_final_results(p_admin uuid, p_force boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare rnd2 rounds; rnd1 rounds; v_cfg jsonb := _round2_config(); v_pending integer; v_missing integer; v_unlocked integer; v_n integer;
  v_ai_on boolean; v_jury_on boolean; v_ai_max numeric; v_w1 numeric; v_w2 numeric;
begin
  select * into rnd2 from rounds where round_number = 2 for update;
  select * into rnd1 from rounds where round_number = 1;
  if rnd2.status <> 'ended' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'End Round 2 before computing final results.');
  end if;
  v_ai_on := coalesce((v_cfg -> 'ai' ->> 'enabled')::boolean, false);
  v_jury_on := coalesce((v_cfg -> 'jury' ->> 'enabled')::boolean, false);
  v_ai_max := coalesce((v_cfg -> 'ai' ->> 'maxPoints')::numeric, 0);
  v_w1 := coalesce((v_cfg -> 'final' ->> 'round1Weight')::numeric, 1);
  v_w2 := coalesce((v_cfg -> 'final' ->> 'round2Weight')::numeric, 1);

  select count(*) into v_pending from round2_eval_jobs where status in ('queued', 'processing', 'failed');
  select count(*) into v_missing from round2_states s
   where v_jury_on and not exists (select 1 from judge_scores j where j.entry_id = s.entry_id);
  select count(*) into v_unlocked from judge_scores where not locked;
  if not p_force and ((v_ai_on and v_pending > 0) or v_missing > 0 or v_unlocked > 0) then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'incomplete',
      'pendingAi', case when v_ai_on then v_pending else 0 end, 'teamsWithoutJuryScore', v_missing, 'unlockedJuryScores', v_unlocked,
      'message', 'Some scores are not final yet (pending AI evaluations, teams without a jury score or unlocked jury scores). Finish them or compute anyway.');
  end if;

  delete from final_results;
  with base as (
    select s.entry_id,
           coalesce((select rr.score from round_results rr where rr.entry_id = s.entry_id and rr.round_id = rnd1.id), 0) as r1,
           case when v_jury_on then coalesce((select round(avg(j.total), 1) from judge_scores j where j.entry_id = s.entry_id), 0) else 0 end as jury,
           case when v_ai_on then coalesce((select round(ai.ai_subtotal / 60.0 * v_ai_max, 1) from round2_ai_evaluations ai where ai.entry_id = s.entry_id), 0) else 0 end as ai,
           (select rv.new_score from round2_reviews rv where rv.entry_id = s.entry_id order by rv.created_at desc limit 1) as override
      from round2_states s join entries e on e.id = s.entry_id
     where not e.disqualified
  ), scored as (
    select entry_id, r1, jury, ai, coalesce(override, jury + ai) as r2 from base
  ), ranked as (
    select *, round(v_w1 * r1 + v_w2 * r2, 1) as final_score from scored
  )
  insert into final_results (entry_id, round1_score, round2_score, round2_jury, round2_ai, final_score, rank, released, computed_at, computed_by)
  select entry_id, r1, r2, jury, ai, final_score, rank() over (order by final_score desc), false, now(), p_admin from ranked;
  get diagnostics v_n = row_count;
  update event_settings set value = jsonb_set(value, '{final,published}', 'false'::jsonb), updated_at = now() where key = 'results_publication';
  insert into admin_actions (admin_id, action, new_value)
  values (p_admin, 'compute_final_results', jsonb_build_object('entries', v_n, 'forced', p_force, 'pendingAi', v_pending,
          'teamsWithoutJuryScore', v_missing, 'unlockedJuryScores', v_unlocked, 'weights', v_cfg -> 'final'));
  return jsonb_build_object('ok', true, 'entries', v_n);
end $$;

-- ---------------------------------------------------------------------
-- Student dashboard and results (one round trip each)
-- ---------------------------------------------------------------------
create or replace function student_dashboard(p_sid uuid, p_entry uuid)
returns jsonb language plpgsql set search_path = public as $$
declare e entries; r1 rounds; r2 rounds; v_members jsonb; v_ann jsonb; v_pub jsonb; v_finalist boolean; v_r1 jsonb; v_r2state text;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session_invalid');
  end if;
  perform round1_tick();
  perform round2_tick();
  select * into e from entries where id = p_entry;
  select * into r1 from rounds where round_number = 1;
  select * into r2 from rounds where round_number = 2;
  select coalesce(jsonb_agg(jsonb_build_object('name', m.full_name, 'position', m.member_position) order by m.member_position), '[]'::jsonb)
    into v_members from team_members m where m.entry_id = p_entry;
  v_finalist := exists (select 1 from round2_qualifiers where entry_id = p_entry);
  select jsonb_build_object(
      'assigned', count(*),
      'submitted', count(*) filter (where s.status = 'submitted'),
      'submissionRef', max(s.submission_ref))
    into v_r1
    from submissions s join challenge_assignments a on a.id = s.assignment_id
   where s.entry_id = p_entry and a.round_id = r1.id;
  select state into v_r2state from round2_states where entry_id = p_entry;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'message', x.message, 'createdAt', x.created_at) order by x.created_at desc), '[]'::jsonb)
    into v_ann
    from (select a.* from announcements a
           where a.active
             and (a.audience = 'all'
                  or (a.audience = 'checked_in' and e.present)
                  or (a.audience = 'round2' and v_finalist)
                  or (a.audience = 'entries' and p_entry = any (a.entry_ids)))
           order by a.created_at desc limit 8) x;
  select value into v_pub from event_settings where key = 'results_publication';
  return jsonb_build_object('ok', true, 'serverNow', now(),
    'entry', jsonb_build_object('entryNumber', e.entry_number, 'teamName', e.team_name, 'isTeam', e.is_team,
                                'present', e.present, 'disqualified', e.disqualified, 'members', v_members),
    'round1', jsonb_build_object('status', r1.status, 'startAt', r1.round_start_at, 'endAt', r1.round_end_at) || coalesce(v_r1, '{}'::jsonb),
    'round2', jsonb_build_object('status', r2.status, 'startAt', r2.round_start_at, 'endAt', r2.round_end_at,
                                 'finalist', v_finalist, 'state', v_r2state),
    'results', jsonb_build_object('round1Published', coalesce((v_pub -> 'round1' ->> 'published')::boolean, false),
                                  'finalPublished', coalesce((v_pub -> 'final' ->> 'published')::boolean, false)),
    'announcements', v_ann);
end $$;

create or replace function student_results(p_sid uuid, p_entry uuid)
returns jsonb language plpgsql set search_path = public as $$
declare v_pub jsonb; p1 jsonb; pf jsonb; r1 rounds; v_r1 jsonb := null; v_final jsonb := null; rr round_results; fr final_results;
  v_ch jsonb; v_lb jsonb; v_n integer;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session_invalid');
  end if;
  select value into v_pub from event_settings where key = 'results_publication';
  p1 := coalesce(v_pub -> 'round1', '{}'::jsonb);
  pf := coalesce(v_pub -> 'final', '{}'::jsonb);
  select * into r1 from rounds where round_number = 1;

  if coalesce((p1 ->> 'published')::boolean, false) then
    select * into rr from round_results where entry_id = p_entry and round_id = r1.id;
    select count(*) into v_n from round_results where round_id = r1.id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'position', a.position,
             'title', coalesce(a.challenge_snapshot ->> 'title', 'Challenge ' || a.position),
             'score', case when coalesce((p1 ->> 'showScore')::boolean, true) then
                        coalesce((select hr.new_total from human_reviews hr where hr.submission_id = s.id order by hr.created_at desc limit 1), ae.total) end,
             'maxScore', 50,
             'feedback', case when coalesce((p1 ->> 'showFeedback')::boolean, false) then ae.summary end)
           order by a.position), '[]'::jsonb)
      into v_ch
      from challenge_assignments a
      join submissions s on s.assignment_id = a.id
      left join ai_evaluations ae on ae.submission_id = s.id
     where a.entry_id = p_entry and a.round_id = r1.id;
    if coalesce((p1 ->> 'showLeaderboard')::boolean, false) then
      select coalesce(jsonb_agg(jsonb_build_object('rank', x.rank, 'entryNumber', x.entry_number, 'teamName', x.team_name,
               'score', case when coalesce((p1 ->> 'showScore')::boolean, true) then x.score end, 'you', x.entry_id = p_entry) order by x.rank, x.entry_number), '[]'::jsonb)
        into v_lb
        from (select rr2.rank, rr2.score, rr2.entry_id, e.entry_number, e.team_name from round_results rr2 join entries e on e.id = rr2.entry_id
               where rr2.round_id = r1.id order by rr2.rank, e.entry_number limit least(greatest(coalesce((p1 ->> 'leaderboardSize')::integer, 10), 1), 100)) x;
    end if;
    v_r1 := jsonb_build_object('published', true,
      'score', case when coalesce((p1 ->> 'showScore')::boolean, true) then rr.score end, 'maxScore', 200,
      'rank', case when coalesce((p1 ->> 'showRank')::boolean, true) then rr.rank end, 'totalRanked', v_n,
      'qualified', case when coalesce((p1 ->> 'showQualification')::boolean, true) then
                   (exists (select 1 from round2_qualifiers q where q.entry_id = p_entry) or coalesce(rr.qualified, false)) end,
      'hasResult', rr.id is not null,
      'challenges', v_ch, 'leaderboard', v_lb);
  end if;

  if coalesce((pf ->> 'published')::boolean, false) then
    select * into fr from final_results where entry_id = p_entry;
    v_lb := null;
    if coalesce((pf ->> 'showLeaderboard')::boolean, false) then
      select coalesce(jsonb_agg(jsonb_build_object('rank', x.rank, 'entryNumber', x.entry_number, 'teamName', x.team_name,
               'score', case when coalesce((pf ->> 'showScore')::boolean, true) then x.final_score end, 'you', x.entry_id = p_entry) order by x.rank, x.entry_number), '[]'::jsonb)
        into v_lb
        from (select f.rank, f.final_score, f.entry_id, e.entry_number, e.team_name from final_results f join entries e on e.id = f.entry_id
               order by f.rank, e.entry_number limit least(greatest(coalesce((pf ->> 'leaderboardSize')::integer, 10), 1), 100)) x;
    end if;
    v_final := jsonb_build_object('published', true, 'finalist', fr.id is not null,
      'round1Score', case when coalesce((pf ->> 'showScore')::boolean, true) then fr.round1_score end,
      'round2Score', case when coalesce((pf ->> 'showScore')::boolean, true) then fr.round2_score end,
      'finalScore', case when coalesce((pf ->> 'showScore')::boolean, true) then fr.final_score end,
      'rank', case when coalesce((pf ->> 'showRank')::boolean, true) then fr.rank end,
      'totalRanked', (select count(*) from final_results),
      'feedback', case when coalesce((pf ->> 'showFeedback')::boolean, false) then
                    (select summary from round2_ai_evaluations where entry_id = p_entry) end,
      'leaderboard', v_lb);
  end if;
  return jsonb_build_object('ok', true, 'round1', coalesce(v_r1, jsonb_build_object('published', false)),
                            'final', coalesce(v_final, jsonb_build_object('published', false)));
end $$;

-- Saves publication settings (validated keys only) and audits who did it.
create or replace function set_results_publication(p_admin uuid, p_scope text, p_settings jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_scope jsonb; v_pub boolean;
begin
  if p_scope not in ('round1', 'final') then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_scope');
  end if;
  select value into v_old from event_settings where key = 'results_publication' for update;
  v_scope := coalesce(v_old -> p_scope, '{}'::jsonb);
  v_pub := coalesce((p_settings ->> 'published')::boolean, (v_scope ->> 'published')::boolean, false);
  if v_pub then
    if p_scope = 'round1' and not exists (select 1 from round_results rr join rounds r on r.id = rr.round_id where r.round_number = 1) then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'no_results', 'message', 'Compute Round 1 results before publishing them.');
    end if;
    if p_scope = 'final' and not exists (select 1 from final_results) then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'no_results', 'message', 'Compute final results before publishing them.');
    end if;
  end if;
  v_scope := v_scope || jsonb_strip_nulls(jsonb_build_object(
      'published', v_pub,
      'showScore', (p_settings ->> 'showScore')::boolean,
      'showRank', (p_settings ->> 'showRank')::boolean,
      'showQualification', (p_settings ->> 'showQualification')::boolean,
      'showFeedback', (p_settings ->> 'showFeedback')::boolean,
      'showLeaderboard', (p_settings ->> 'showLeaderboard')::boolean,
      'leaderboardSize', case when p_settings ? 'leaderboardSize'
                              then least(greatest((p_settings ->> 'leaderboardSize')::integer, 1), 100) end));
  if v_pub and not coalesce((v_old -> p_scope ->> 'published')::boolean, false) then
    v_scope := v_scope || jsonb_build_object('publishedAt', now(), 'publishedBy', p_admin);
  end if;
  v_new := coalesce(v_old, '{}'::jsonb) || jsonb_build_object(p_scope, v_scope);
  insert into event_settings (key, value, updated_at) values ('results_publication', v_new, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_scope = 'final' then update final_results set released = v_pub; end if;
  insert into admin_actions (admin_id, action, old_value, new_value)
  values (p_admin, 'results_publication_' || p_scope, v_old -> p_scope, v_scope);
  return jsonb_build_object('ok', true, 'settings', v_new);
end $$;

-- ---------------------------------------------------------------------
-- Global reset: now also clears Round 2 finalists/jobs/overrides and
-- unpublishes results. Keeps Round 2 problems, twists and configuration.
-- ---------------------------------------------------------------------
create or replace function competition_reset_preview()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'clear', jsonb_build_object(
      'round1Assignments', (select count(*) from challenge_assignments),
      'round1Submissions', (select count(*) from submissions),
      'evaluationJobs', (select count(*) from evaluation_jobs) + (select count(*) from round2_eval_jobs),
      'aiEvaluations', (select count(*) from ai_evaluations) + (select count(*) from round2_ai_evaluations),
      'scoreOverrides', (select count(*) from human_reviews) + (select count(*) from round2_reviews),
      'round1Results', (select count(*) from round_results),
      'round2Finalists', (select count(*) from round2_qualifiers),
      'round2Work', (select count(*) from round2_states),
      'juryQuestions', (select count(*) from judge_questions),
      'juryScores', (select count(*) from judge_scores),
      'finalResults', (select count(*) from final_results),
      'announcements', (select count(*) from announcements)),
    'keep', jsonb_build_object(
      'entries', (select count(*) from entries),
      'members', (select count(*) from team_members),
      'checkedIn', (select count(*) from entries where present),
      'withPin', (select count(*) from entries where pin_hash is not null),
      'challenges', (select count(*) from challenges),
      'round2Problems', (select count(*) from round2_problems),
      'twists', (select count(*) from surprise_twists),
      'organizers', (select count(*) from admins) + (select count(*) from judges)),
    'rounds', (select jsonb_object_agg('round' || round_number, status) from rounds),
    'blocked', exists (select 1 from rounds where status in ('running', 'paused')))
$$;

create or replace function competition_reset(p_admin uuid, p_confirm text)
returns jsonb language plpgsql set search_path = public as $$
declare v_active text; v jsonb;
  n_asg integer; n_sub integer; n_ver integer; n_jobs integer; n_ai integer; n_hr integer; n_rr integer;
  n_r2a integer; n_r2s integer; n_jq integer; n_js integer; n_r2ai integer; n_fr integer; n_logs integer; n_ann integer;
  n_q integer; n_r2j integer; n_r2rv integer;
begin
  if coalesce(p_confirm, '') <> 'RESET COMPETITION' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'confirmation_required', 'message', 'Type RESET COMPETITION to confirm.');
  end if;
  perform pg_advisory_xact_lock(hashtext('competition_reset'));
  perform pg_advisory_xact_lock(hashtext('challenge_pool'));
  select string_agg('Round ' || round_number, ', ') into v_active
    from (select round_number, status from rounds order by round_number for update) r
   where status in ('running', 'paused');
  if v_active is not null then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_active',
      'message', v_active || ' is running or paused. Stop it first, then reset.');
  end if;

  select count(*) into n_asg from challenge_assignments;
  select count(*) into n_sub from submissions;
  select count(*) into n_ver from submission_versions;
  select count(*) into n_jobs from evaluation_jobs;
  select count(*) into n_ai from ai_evaluations;
  select count(*) into n_hr from human_reviews;

  delete from challenge_assignments;
  delete from submissions;
  delete from round_results;             get diagnostics n_rr = row_count;
  delete from final_results;             get diagnostics n_fr = row_count;
  delete from round2_eval_jobs;          get diagnostics n_r2j = row_count;
  delete from round2_reviews;            get diagnostics n_r2rv = row_count;
  delete from round2_ai_evaluations;     get diagnostics n_r2ai = row_count;
  delete from judge_scores;              get diagnostics n_js = row_count;
  delete from judge_questions;           get diagnostics n_jq = row_count;
  delete from round2_states;             get diagnostics n_r2s = row_count;
  delete from round2_assignments;        get diagnostics n_r2a = row_count;
  delete from round2_qualifiers;         get diagnostics n_q = row_count;
  delete from activity_logs where event_type in ('submission', 'tab_hidden', 'tab_visible', 'window_blur', 'paste_blocked');
  get diagnostics n_logs = row_count;
  delete from announcements;             get diagnostics n_ann = row_count;

  update rounds set status = 'not_started', round_start_at = null, round_end_at = null, paused_at = null, total_paused_seconds = 0;
  update event_settings set value = jsonb_set(jsonb_set(value, '{round1,published}', 'false'::jsonb), '{final,published}', 'false'::jsonb),
         updated_at = now() where key = 'results_publication';

  v := jsonb_build_object('assignments', n_asg, 'submissions', n_sub, 'submission_versions', n_ver, 'evaluation_jobs', n_jobs,
    'ai_evaluations', n_ai, 'human_reviews', n_hr, 'round_results', n_rr, 'final_results', n_fr, 'round2_ai_evaluations', n_r2ai,
    'round2_eval_jobs', n_r2j, 'round2_reviews', n_r2rv, 'round2_qualifiers', n_q,
    'judge_scores', n_js, 'judge_questions', n_jq, 'round2_states', n_r2s, 'round2_assignments', n_r2a,
    'activity_logs', n_logs, 'announcements', n_ann);
  insert into admin_actions (admin_id, action, reason, new_value)
  values (p_admin, 'reset_competition', 'Reset Competition Data (Round 1 + Round 2)',
          jsonb_build_object('rounds', jsonb_build_array(1, 2), 'deleted', v));
  return jsonb_build_object('ok', true, 'rounds', jsonb_build_array(1, 2), 'deleted', v);
end $$;

-- ---------------------------------------------------------------------
-- Schema health: lets the app report "migrations missing" instead of a
-- generic 500 when it is pointed at a database that is behind.
-- ---------------------------------------------------------------------
create or replace function app_schema_status()
returns jsonb language sql stable set search_path = public as $$
  with fn(name) as (values
    ('rate_limit_hit'), ('auth_session_validate'), ('student_login_precheck'), ('student_login'), ('round1_control'),
    ('round1_preflight'), ('student_round1_state'), ('student_autosave'), ('student_advance'), ('claim_evaluation_jobs'),
    ('compute_round1_results'), ('import_participants'), ('set_entry_pins'), ('publish_challenge_import'),
    ('competition_reset'), ('competition_reset_preview'), ('round2_control'), ('round2_preflight'), ('student_round2_state'),
    ('student_round2_save'), ('student_dashboard'), ('student_results'), ('compute_final_results'), ('set_results_publication')),
  tb(name) as (values ('auth_sessions'), ('rate_limits'), ('challenge_import_batches'), ('round2_qualifiers'), ('round2_eval_jobs'), ('round2_reviews'))
  select jsonb_build_object('version', 6,
    'missingFunctions', coalesce((select jsonb_agg(f.name) from fn f
        where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.name)), '[]'::jsonb),
    'missingTables', coalesce((select jsonb_agg(t.name) from tb t where to_regclass('public.' || t.name) is null), '[]'::jsonb))
$$;

-- =====================================================================
-- Privileges: service role only
-- =====================================================================
do $$
declare f record; t text;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_round2_default_config', '_round2_config', '_round2_jury_max', '_round2_problem_snapshot', '_round2_twist_snapshot',
                         'round2_save_config', 'round2_set_qualifiers', 'round2_preflight', '_round2_assign', '_round2_finalize_entry',
                         '_round2_finalize_all', 'round2_tick', 'round2_control', 'round1_start_over', 'student_round2_state',
                         'student_round2_save', 'student_round2_answer', 'jury_ask_question', 'jury_save_score', 'jury_unlock_score',
                         'claim_round2_eval_jobs', 'compute_final_results', 'student_dashboard', 'student_results',
                         'set_results_publication', 'competition_reset_preview', 'competition_reset', 'app_schema_status')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
  foreach t in array array['round2_qualifiers', 'round2_eval_jobs', 'round2_reviews'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on table %I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on table %I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
end $$;
