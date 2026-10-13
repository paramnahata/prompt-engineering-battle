-- =====================================================================
-- 0005 — Team PINs, challenge-pool management, eligibility rules,
--        global competition reset, race-condition fixes.
--
-- Additive. Requires 0004. Every function is service_role-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Team PINs (hash only; the PIN itself is shown once to the organizer
-- who issues it and is never stored or returned again)
-- ---------------------------------------------------------------------
alter table entries add column if not exists pin_hash text;
alter table entries add column if not exists pin_set_at timestamptz;
alter table entries add column if not exists pin_set_by uuid;

-- ---------------------------------------------------------------------
-- Challenge pool
-- ---------------------------------------------------------------------
alter table challenges drop constraint if exists challenges_difficulty_check;
do $$ begin
  alter table challenges add constraint challenges_difficulty_check
    check (difficulty in ('easy', 'medium', 'hard', 'expert', 'unrated'));
exception when duplicate_object then null; end $$;

-- approved = may be used in the real event; review = imported/edited but not
-- yet approved; test = demo/test question; archived = removed from the pool
-- (kept because past submissions may reference it).
alter table challenges add column if not exists pool_status text not null default 'review';
do $$ begin
  alter table challenges add constraint challenges_pool_status_check
    check (pool_status in ('approved', 'review', 'test', 'archived'));
exception when duplicate_object then null; end $$;
alter table challenges add column if not exists updated_at timestamptz not null default now();
alter table challenges add column if not exists updated_by uuid;
alter table challenges add column if not exists source_batch_id uuid;
alter table challenges add column if not exists source_ref text;

create index if not exists idx_challenges_pool on challenges(pool_status, active, difficulty);
create index if not exists idx_challenges_category_lower on challenges(lower(category));

-- Existing rows were never reviewed (and their difficulty was a column
-- default), so nothing is eligible for the event until an admin approves it
-- or a reviewed file is published.
update challenges set pool_status = 'review' where pool_status is null;

create table if not exists challenge_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'discarded')),
  mapping jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  row_errors jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  publish_mode text
);
create index if not exists idx_challenge_import_batches_created on challenge_import_batches(created_at desc);
alter table challenge_import_batches enable row level security;

-- Snapshot of the challenge as it was when assigned, so later edits,
-- disabling or replacing the pool never change what a team was given,
-- what was evaluated, or what the results page shows.
alter table challenge_assignments add column if not exists challenge_snapshot jsonb;

-- Assignment rules (admin-editable on the Challenge pool page).
insert into event_settings (key, value)
values ('round1_assignment_rules', '{"allowedDifficulties": ["medium", "hard", "expert"], "slot3Difficulties": [], "slot4Difficulties": [], "allowedCategories": [], "distinctCategories": true}'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- FUNCTIONS
-- =====================================================================

create or replace function _challenge_snapshot(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'challenge_code', c.challenge_code, 'title', c.title, 'category', c.category, 'difficulty', c.difficulty,
    'problem_statement', c.problem_statement, 'instructions', c.instructions, 'constraints', c.constraints,
    'expected_output', c.expected_output, 'evaluation_criteria', c.evaluation_criteria,
    'prompt_word_limit', c.prompt_word_limit, 'output_char_limit', c.output_char_limit,
    'snapshot_at', now())
  from challenges c where c.id = p_id
$$;

create or replace function _round1_rules()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
      'allowedDifficulties', '["medium", "hard", "expert"]'::jsonb,
      'slot3Difficulties', '[]'::jsonb, 'slot4Difficulties', '[]'::jsonb,
      'allowedCategories', '[]'::jsonb, 'distinctCategories', true)
    || coalesce((select value from event_settings where key = 'round1_assignment_rules'), '{}'::jsonb)
$$;

-- Is a challenge eligible for random slot 3 or 4 under the rules?
create or replace function _slot_eligible(c challenges, p_rules jsonb, p_slot integer)
returns boolean language plpgsql stable set search_path = public as $$
declare v_slot jsonb := p_rules -> (case when p_slot = 3 then 'slot3Difficulties' else 'slot4Difficulties' end);
begin
  return c.active and c.pool_status = 'approved' and c.common_slot is null
     and c.difficulty in (select jsonb_array_elements_text(p_rules -> 'allowedDifficulties'))
     and (jsonb_array_length(coalesce(v_slot, '[]'::jsonb)) = 0
          or c.difficulty in (select jsonb_array_elements_text(v_slot)))
     and (jsonb_array_length(coalesce(p_rules -> 'allowedCategories', '[]'::jsonb)) = 0
          or lower(coalesce(c.category, '')) in (select lower(x) from jsonb_array_elements_text(p_rules -> 'allowedCategories') x));
end $$;

-- Everything an admin needs to know before starting, and the gate the
-- start action itself uses.
create or replace function round1_preflight()
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_rules jsonb := _round1_rules();
  v_errors text[] := '{}';
  v_warnings text[] := '{}';
  v_present integer; v_needing integer; v_bad_size integer; v_no_pin integer;
  v_s3 integer; v_s4 integer; v_union integer; v_common jsonb := '[]'::jsonb;
  c record; v_slot integer;
begin
  select count(*) into v_present from entries where present and not disqualified;
  select count(*) into v_needing from entries e
   where present and not disqualified
     and not exists (select 1 from challenge_assignments a join rounds r on r.id = a.round_id and r.round_number = 1 where a.entry_id = e.id);
  select count(*) into v_bad_size from entries e
   where present and not disqualified
     and (select count(*) from team_members m where m.entry_id = e.id) not between 1 and 2;
  select count(*) into v_no_pin from entries where present and not disqualified and pin_hash is null;

  for v_slot in 1..2 loop
    select * into c from challenges where common_slot = v_slot;
    if not found then
      v_errors := v_errors || format('Common %s is not chosen.', case v_slot when 1 then 'A' else 'B' end);
      v_common := v_common || jsonb_build_object('slot', v_slot, 'chosen', false);
    else
      if not c.active or c.pool_status <> 'approved' then
        v_errors := v_errors || format('Common %s (%s) must be active and approved.', case v_slot when 1 then 'A' else 'B' end, c.challenge_code);
      end if;
      if c.difficulty in ('easy', 'unrated') then
        v_warnings := v_warnings || format('Common %s (%s) is rated %s.', case v_slot when 1 then 'A' else 'B' end, c.challenge_code, c.difficulty);
      end if;
      v_common := v_common || jsonb_build_object('slot', v_slot, 'chosen', true, 'id', c.id, 'code', c.challenge_code,
        'title', c.title, 'difficulty', c.difficulty, 'category', c.category,
        'eligible', c.active and c.pool_status = 'approved');
    end if;
  end loop;

  select count(*) filter (where _slot_eligible(ch, v_rules, 3)),
         count(*) filter (where _slot_eligible(ch, v_rules, 4)),
         count(*) filter (where _slot_eligible(ch, v_rules, 3) or _slot_eligible(ch, v_rules, 4))
    into v_s3, v_s4, v_union from challenges ch;

  if v_s3 = 0 then v_errors := v_errors || 'No eligible challenges for random slot 3 under the current rules.'::text; end if;
  if v_s4 = 0 then v_errors := v_errors || 'No eligible challenges for random slot 4 under the current rules.'::text; end if;
  if v_union < 2 then v_errors := v_errors || 'At least two different eligible challenges are needed for slots 3 and 4.'::text; end if;
  if v_bad_size > 0 then v_errors := v_errors || format('%s checked-in entr%s with no members or more than 2 members.', v_bad_size, case when v_bad_size = 1 then 'y has' else 'ies have' end); end if;
  if v_present = 0 then v_errors := v_errors || 'No entries are checked in.'::text; end if;
  if v_no_pin > 0 then v_warnings := v_warnings || format('%s checked-in entr%s no PIN yet and cannot sign in.', v_no_pin, case when v_no_pin = 1 then 'y has' else 'ies have' end); end if;
  if v_present > 0 and least(v_s3, v_s4) between 1 and 9 then
    v_warnings := v_warnings || format('Only %s eligible challenge(s) for a random slot — each will be reused about %s times.', least(v_s3, v_s4), ceil(v_present::numeric / greatest(least(v_s3, v_s4), 1)));
  end if;

  return jsonb_build_object('ok', array_length(v_errors, 1) is null, 'errors', to_jsonb(v_errors), 'warnings', to_jsonb(v_warnings),
    'presentEntries', v_present, 'entriesNeedingAssignment', v_needing, 'invalidTeamSize', v_bad_size, 'entriesWithoutPin', v_no_pin,
    'common', v_common, 'slot3Eligible', v_s3, 'slot4Eligible', v_s4, 'rules', v_rules);
end $$;

-- Assigns challenges to every present, non-disqualified entry with a valid
-- team size that has none yet. Slots 3/4 pick the least-used eligible
-- challenge (random tie-break), distinct from each other, from different
-- categories when the rule asks for it. Every assignment stores a snapshot.
-- Returns the number of entries assigned, or a negative code.
create or replace function _round1_assign_missing(p_round uuid)
returns integer language plpgsql set search_path = public as $$
declare
  v_rules jsonb := _round1_rules();
  v_common_a uuid; v_common_b uuid; v_count integer := 0; e record; v_c3 uuid; v_c3_cat text; v_c4 uuid;
  v_distinct boolean := coalesce((_round1_rules() ->> 'distinctCategories')::boolean, false);
begin
  select id into v_common_a from challenges where common_slot = 1 and active and pool_status = 'approved';
  select id into v_common_b from challenges where common_slot = 2 and active and pool_status = 'approved';
  if v_common_a is null or v_common_b is null then return -1; end if;

  create temporary table _pool on commit drop as
    select c.id, lower(coalesce(c.category, '')) as cat, _slot_eligible(c, v_rules, 3) as s3, _slot_eligible(c, v_rules, 4) as s4,
           0 as used, random() as tie
      from challenges c
     where _slot_eligible(c, v_rules, 3) or _slot_eligible(c, v_rules, 4);
  if (select count(*) from _pool) < 2 or not exists (select 1 from _pool where s3) or not exists (select 1 from _pool where s4) then
    drop table _pool;
    return -2;
  end if;

  for e in
    select en.id from entries en
     where en.present and not en.disqualified
       and (select count(*) from team_members m where m.entry_id = en.id) between 1 and 2
       and not exists (select 1 from challenge_assignments a where a.entry_id = en.id and a.round_id = p_round)
     order by random()
  loop
    select id, cat into v_c3, v_c3_cat from _pool where s3 order by used, tie, random() limit 1;
    select id into v_c4 from _pool
     where s4 and id <> v_c3 and (not v_distinct or cat <> v_c3_cat)
     order by used, tie, random() limit 1;
    if v_c4 is null then
      select id into v_c4 from _pool where s4 and id <> v_c3 order by used, tie, random() limit 1;
    end if;
    if v_c3 is null or v_c4 is null then
      raise exception 'ASSIGNMENT_POOL_EXHAUSTED';
    end if;
    update _pool set used = used + 1, tie = random() where id in (v_c3, v_c4);

    insert into challenge_assignments (entry_id, round_id, challenge_id, position, is_common, challenge_snapshot) values
      (e.id, p_round, v_common_a, 1, true, _challenge_snapshot(v_common_a)),
      (e.id, p_round, v_common_b, 2, true, _challenge_snapshot(v_common_b)),
      (e.id, p_round, v_c3, 3, false, _challenge_snapshot(v_c3)),
      (e.id, p_round, v_c4, 4, false, _challenge_snapshot(v_c4));
    v_count := v_count + 1;
  end loop;
  drop table _pool;

  insert into submissions (assignment_id, entry_id)
  select a.id, a.entry_id from challenge_assignments a where a.round_id = p_round
  on conflict (assignment_id) do nothing;

  -- Verification: every eligible entry now has exactly positions 1-4.
  if exists (
    select 1 from entries en
     where en.present and not en.disqualified
       and (select count(*) from team_members m where m.entry_id = en.id) between 1 and 2
       and (select count(distinct position) from challenge_assignments a where a.entry_id = en.id and a.round_id = p_round) <> 4
  ) then
    raise exception 'ASSIGNMENT_VERIFICATION_FAILED';
  end if;
  return v_count;
end $$;

create or replace function _round1_assign_error(p_code integer)
returns jsonb language sql immutable set search_path = public as $$
  select case p_code
    when -1 then jsonb_build_object('ok', false, 'status', 409, 'code', 'common_not_configured',
      'message', 'Common A and Common B must be chosen, active and approved (Challenge pool page).')
    else jsonb_build_object('ok', false, 'status', 409, 'code', 'pool_too_small',
      'message', 'Not enough eligible challenges for the random slots under the current rules.')
  end
$$;

-- round1_control: same contract as 0004, but start is gated by the preflight.
create or replace function round1_control(p_action text, p_admin uuid, p_confirm text default null)
returns jsonb language plpgsql set search_path = public as $$
declare r rounds; v_delta interval; v_assigned integer; v_finalized integer; v_deleted integer; v_duration integer; v_pre jsonb;
begin
  perform round1_tick();
  select * into r from rounds where round_number = 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'round_missing', 'message', 'Round 1 is not configured.');
  end if;

  if p_action = 'start' then
    if r.status <> 'not_started' then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state',
        'message', 'Round 1 is ' || r.status || '. Reset the competition before starting again.');
    end if;
    v_pre := round1_preflight();
    if not (v_pre ->> 'ok')::boolean then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'preflight_failed',
        'message', v_pre -> 'errors' ->> 0, 'preflight', v_pre);
    end if;
    v_assigned := _round1_assign_missing(r.id);
    if v_assigned < 0 then return _round1_assign_error(v_assigned); end if;
    v_duration := coalesce((r.config ->> 'round_duration_seconds')::integer, 1800);
    update rounds set status = 'running', round_start_at = now(),
           round_end_at = now() + make_interval(secs => v_duration),
           paused_at = null, total_paused_seconds = 0
     where id = r.id;
    insert into admin_actions (admin_id, action, new_value)
    values (p_admin, 'start_round1', jsonb_build_object('assigned', v_assigned, 'duration_seconds', v_duration, 'rules', v_pre -> 'rules'));
    update announcements set active = false where active and message like 'Round 1%';
    insert into announcements (message, active, created_by) values ('Round 1 has started!', true, p_admin);
    return jsonb_build_object('ok', true, 'roundStatus', 'running', 'assigned', v_assigned, 'warnings', v_pre -> 'warnings');

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
    -- Round-1-only reset kept for compatibility; the UI uses competition_reset.
    if coalesce(p_confirm, '') <> 'START OVER' then
      return jsonb_build_object('ok', false, 'status', 400, 'code', 'confirmation_required', 'message', 'Type START OVER to confirm.');
    end if;
    if r.status in ('running', 'paused') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'bad_state', 'message', 'Stop Round 1 before starting over.');
    end if;
    select count(*) into v_deleted from challenge_assignments where round_id = r.id;
    delete from challenge_assignments where round_id = r.id;
    delete from round_results where round_id = r.id;
    update rounds set status = 'not_started', round_start_at = null, round_end_at = null, paused_at = null, total_paused_seconds = 0 where id = r.id;
    insert into admin_actions (admin_id, action, reason, old_value, new_value)
    values (p_admin, 'reset_round1', 'Start Over confirmed by admin',
            jsonb_build_object('status', r.status, 'assignments_deleted', v_deleted), jsonb_build_object('status', 'not_started'));
    update announcements set active = false where active and message like 'Round 1%';
    return jsonb_build_object('ok', true, 'roundStatus', 'not_started', 'assignmentsDeleted', v_deleted);
  end if;

  return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_action', 'message', 'Unknown action.');
end $$;

-- Student state now serves the assignment snapshot.
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
           'id', a.id, 'position', a.position, 'locked_at', a.locked_at,
           'challenge', jsonb_build_object(
             'title', snap ->> 'title', 'problem_statement', snap ->> 'problem_statement',
             'instructions', snap ->> 'instructions', 'constraints', snap ->> 'constraints',
             'expected_output', snap ->> 'expected_output',
             'prompt_word_limit', (snap ->> 'prompt_word_limit')::integer,
             'output_char_limit', (snap ->> 'output_char_limit')::integer))
           order by a.position), '[]'::jsonb)
    into v_assignments
    from (select a.*, coalesce(a.challenge_snapshot, _challenge_snapshot(a.challenge_id)) as snap
            from challenge_assignments a where a.entry_id = p_entry and a.round_id = r.id) a;

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

create or replace function student_autosave(p_sid uuid, p_entry uuid, p_submission uuid, p_prompt text, p_output text)
returns jsonb language plpgsql set search_path = public as $$
declare v record; v_words integer;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session');
  end if;
  perform round1_tick();
  select s.id, s.entry_id, s.status, s.question_end_at, s.prompt_text, s.ai_output_text,
         coalesce((a.challenge_snapshot ->> 'prompt_word_limit')::integer, c.prompt_word_limit) as prompt_word_limit,
         coalesce((a.challenge_snapshot ->> 'output_char_limit')::integer, c.output_char_limit) as output_char_limit,
         r.status as round_status
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

create or replace function student_advance(p_sid uuid, p_entry uuid, p_submission uuid, p_prompt text, p_output text)
returns jsonb language plpgsql set search_path = public as $$
declare v record; v_ref text;
begin
  if not _student_session_ok(p_sid, p_entry) then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'session');
  end if;
  perform round1_tick();
  select s.id, s.entry_id, s.status, s.question_end_at, s.submission_ref, a.position, a.round_id,
         coalesce((a.challenge_snapshot ->> 'prompt_word_limit')::integer, c.prompt_word_limit) as prompt_word_limit,
         coalesce((a.challenge_snapshot ->> 'output_char_limit')::integer, c.output_char_limit) as output_char_limit,
         r.status as round_status
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
-- Student login with team PIN
-- ---------------------------------------------------------------------
drop function if exists student_login(integer, boolean, text, text, uuid, integer, integer);

-- Step 1 (before any hashing): IP cap + per-entry lock check, returns the
-- stored hash (or null) so the server can verify the PIN with scrypt.
create or replace function student_login_precheck(p_entry_number integer, p_ip text)
returns jsonb language plpgsql set search_path = public as $$
declare v_hash text;
begin
  -- Generous per-IP cap: a whole college can sit behind one NAT address.
  if not rate_limit_hit('student-login-ip:' || coalesce(p_ip, 'unknown'), 600, 60) then
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited');
  end if;
  if not rate_limit_hit('student-login-entry:' || p_entry_number, 6, 600, false) then
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited');
  end if;
  select pin_hash into v_hash from entries where entry_number = p_entry_number;
  return jsonb_build_object('ok', true, 'pinHash', v_hash);
end $$;

-- Step 2: records failures (6 per entry per 10 min), then the usual
-- attendance / disqualification / one-live-device checks and session.
create or replace function student_login(
  p_entry_number integer, p_code_ok boolean, p_pin_ok boolean, p_user_agent text,
  p_existing_sid uuid, p_ttl_seconds integer, p_active_window_seconds integer)
returns jsonb language plpgsql set search_path = public as $$
declare e entries; v_sid uuid; v_active integer;
begin
  if not rate_limit_hit('student-login-entry:' || p_entry_number, 6, 600, false) then
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited');
  end if;
  if not p_code_ok then
    perform rate_limit_hit('student-login-entry:' || p_entry_number, 6, 600, true);
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'bad_access_code');
  end if;

  select * into e from entries where entry_number = p_entry_number for update;
  if found and e.pin_hash is null then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'pin_not_issued');
  end if;
  if not found or not p_pin_ok then
    perform rate_limit_hit('student-login-entry:' || p_entry_number, 6, 600, true);
    insert into activity_logs (entry_id, event_type, metadata)
    select e.id, 'login_failed', jsonb_build_object('reason', 'bad_credentials') where e.id is not null;
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'bad_credentials');
  end if;
  if e.disqualified then return jsonb_build_object('ok', false, 'status', 403, 'code', 'disqualified'); end if;
  if not e.present then return jsonb_build_object('ok', false, 'status', 403, 'code', 'not_checked_in'); end if;

  if p_existing_sid is not null and exists (
       select 1 from auth_sessions where id = p_existing_sid and entry_id = e.id and ended_at is null and expires_at > now()) then
    update auth_sessions set last_seen_at = now() where id = p_existing_sid;
    return jsonb_build_object('ok', true, 'sid', p_existing_sid, 'entry_id', e.id, 'entry_number', e.entry_number, 'reused', true);
  end if;

  select count(*) into v_active from auth_sessions
   where entry_id = e.id and ended_at is null and expires_at > now()
     and last_seen_at > now() - make_interval(secs => p_active_window_seconds);
  if v_active > 0 then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'already_active');
  end if;

  update auth_sessions set ended_at = now(), end_reason = 'superseded' where entry_id = e.id and ended_at is null;
  insert into auth_sessions (role, subject_id, entry_id, expires_at, user_agent)
  values ('student', e.id, e.id, now() + make_interval(secs => p_ttl_seconds), left(p_user_agent, 200))
  returning id into v_sid;
  insert into activity_logs (entry_id, event_type, metadata) values (e.id, 'login', jsonb_build_object('session_id', v_sid));
  return jsonb_build_object('ok', true, 'sid', v_sid, 'entry_id', e.id, 'entry_number', e.entry_number, 'reused', false);
end $$;

-- Stores PIN hashes computed by the server. Ends the entries' sessions so a
-- re-issued PIN immediately locks out whoever held the old one.
create or replace function set_entry_pins(p_pins jsonb, p_admin uuid, p_only_missing boolean)
returns jsonb language plpgsql set search_path = public as $$
declare v_updated integer; v_ids jsonb;
begin
  with input as (
    select (x ->> 'entry_id')::uuid as entry_id, x ->> 'pin_hash' as pin_hash from jsonb_array_elements(p_pins) x
  ), upd as (
    update entries e set pin_hash = i.pin_hash, pin_set_at = now(), pin_set_by = p_admin
      from input i
     where e.id = i.entry_id and (not p_only_missing or e.pin_hash is null)
    returning e.id
  ), ended as (
    update auth_sessions s set ended_at = now(), end_reason = 'pin_reissued'
     where s.entry_id in (select id from upd) and s.ended_at is null
    returning s.id
  )
  select count(*), coalesce(jsonb_agg(id), '[]'::jsonb) into v_updated, v_ids from upd;
  insert into admin_actions (admin_id, action, entry_id, new_value)
  values (p_admin, case when p_only_missing then 'issue_pins' else 'reissue_pin' end,
          case when not p_only_missing and v_updated = 1 then (v_ids ->> 0)::uuid end,
          jsonb_build_object('entries', v_updated));
  return jsonb_build_object('ok', true, 'updated', v_updated, 'updatedIds', v_ids);
end $$;

-- ---------------------------------------------------------------------
-- Challenge pool publish (atomic). Blocked while a round is active.
-- mode 'merge': insert new codes, update changed ones, leave others.
-- mode 'replace': merge + archive every non-test challenge not in the file.
-- Challenges are never deleted here; assignments keep their snapshots.
-- ---------------------------------------------------------------------
create or replace function publish_challenge_import(p_batch uuid, p_admin uuid, p_mode text, p_pool_status text, p_defaults jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare b challenge_import_batches; v_inserted integer := 0; v_updated integer := 0; v_unchanged integer := 0; v_archived integer := 0; v_total integer;
begin
  if p_mode not in ('merge', 'replace') or p_pool_status not in ('approved', 'review') then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_options', 'message', 'Invalid publish options.');
  end if;
  perform 1 from rounds where status in ('running', 'paused') for update;
  if found then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'round_active', 'message', 'A round is running or paused. Stop it before publishing a new challenge pool.');
  end if;
  perform pg_advisory_xact_lock(hashtext('challenge_pool'));
  select * into b from challenge_import_batches where id = p_batch for update;
  if not found then return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found', 'message', 'Import draft not found.'); end if;
  if b.status <> 'draft' then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'already_' || b.status, 'message', 'This import was already ' || b.status || '.');
  end if;

  create temporary table _rows on commit drop as
    select upper(trim(x ->> 'challenge_code')) as code, x ->> 'title' as title, nullif(x ->> 'category', '') as category,
           coalesce(nullif(x ->> 'difficulty', ''), 'unrated') as difficulty,
           x ->> 'problem_statement' as problem_statement, nullif(x ->> 'expected_output', '') as expected_output,
           nullif(x ->> 'evaluation_criteria', '') as evaluation_criteria, nullif(x ->> 'instructions', '') as instructions,
           nullif(x ->> 'constraints', '') as constraints,
           coalesce((x ->> 'prompt_word_limit')::integer, (p_defaults ->> 'prompt_word_limit')::integer, 150) as prompt_word_limit,
           coalesce((x ->> 'output_char_limit')::integer, (p_defaults ->> 'output_char_limit')::integer, 1500) as output_char_limit,
           (x ->> 'prompt_word_limit') is not null as has_word_limit, (x ->> 'output_char_limit') is not null as has_char_limit,
           x ->> 'source_ref' as source_ref
      from jsonb_array_elements(b.rows) x;
  select count(*) into v_total from _rows;

  with changed as (
    update challenges c set
      title = r.title, category = r.category, difficulty = r.difficulty, problem_statement = r.problem_statement,
      expected_output = r.expected_output, evaluation_criteria = r.evaluation_criteria, instructions = r.instructions,
      constraints = r.constraints,
      prompt_word_limit = case when r.has_word_limit then r.prompt_word_limit else c.prompt_word_limit end,
      output_char_limit = case when r.has_char_limit then r.output_char_limit else c.output_char_limit end,
      pool_status = p_pool_status, active = true, updated_at = now(), updated_by = p_admin, source_batch_id = b.id, source_ref = r.source_ref
      from _rows r
     where c.challenge_code = r.code
       and (c.title, c.category, c.difficulty, c.problem_statement, c.expected_output, c.evaluation_criteria, c.instructions, c.constraints,
            c.pool_status, c.active)
           is distinct from
           (r.title, r.category, r.difficulty, r.problem_statement, r.expected_output, r.evaluation_criteria, r.instructions, r.constraints,
            p_pool_status, true)
    returning c.id
  ) select count(*) into v_updated from changed;

  with ins as (
    insert into challenges (challenge_code, title, category, difficulty, problem_statement, expected_output, evaluation_criteria,
                            instructions, constraints, prompt_word_limit, output_char_limit, active, pool_status, created_by,
                            updated_by, source_batch_id, source_ref)
    select r.code, r.title, r.category, r.difficulty, r.problem_statement, r.expected_output, r.evaluation_criteria,
           r.instructions, r.constraints, r.prompt_word_limit, r.output_char_limit, true, p_pool_status, p_admin, p_admin, b.id, r.source_ref
      from _rows r
     where not exists (select 1 from challenges c where c.challenge_code = r.code)
    returning id
  ) select count(*) into v_inserted from ins;

  v_unchanged := v_total - v_inserted - v_updated;

  if p_mode = 'replace' then
    with arch as (
      update challenges c set active = false, pool_status = 'archived', common_slot = null, updated_at = now(), updated_by = p_admin
       where c.pool_status <> 'test' and c.pool_status <> 'archived'
         and not exists (select 1 from _rows r where r.code = c.challenge_code)
      returning c.id
    ) select count(*) into v_archived from arch;
  end if;
  drop table _rows;

  update challenge_import_batches set status = 'published', published_by = p_admin, published_at = now(), publish_mode = p_mode,
         summary = summary || jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
                                                 'archived', v_archived, 'pool_status', p_pool_status)
   where id = b.id;
  insert into admin_actions (admin_id, action, new_value)
  values (p_admin, 'challenge_pool_publish', jsonb_build_object('batch_id', b.id, 'file', b.file_name, 'mode', p_mode,
          'pool_status', p_pool_status, 'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged, 'archived', v_archived));
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged, 'archived', v_archived);
end $$;

-- ---------------------------------------------------------------------
-- Global competition reset (Round 1 + Round 2). Preserves registrations,
-- members, entry numbers, PINs, attendance, the challenge pool, accounts
-- and settings.
-- ---------------------------------------------------------------------
create or replace function competition_reset(p_admin uuid, p_confirm text)
returns jsonb language plpgsql set search_path = public as $$
declare v_active text; v jsonb;
  n_asg integer; n_sub integer; n_ver integer; n_jobs integer; n_ai integer; n_hr integer; n_rr integer;
  n_r2a integer; n_r2s integer; n_jq integer; n_js integer; n_r2ai integer; n_fr integer; n_logs integer; n_ann integer;
begin
  if coalesce(p_confirm, '') <> 'RESET COMPETITION' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'confirmation_required', 'message', 'Type RESET COMPETITION to confirm.');
  end if;
  perform pg_advisory_xact_lock(hashtext('competition_reset'));
  perform pg_advisory_xact_lock(hashtext('challenge_pool'));
  -- Locks both round rows: start/pause/stop and student writes wait or see the new state.
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

  -- Order respects foreign keys; assignment deletion cascades to
  -- submissions → versions, evaluation jobs, AI evaluations, human reviews.
  delete from challenge_assignments;
  delete from submissions;               -- orphans, if any
  delete from round_results;             get diagnostics n_rr = row_count;
  delete from final_results;             get diagnostics n_fr = row_count;
  delete from round2_ai_evaluations;     get diagnostics n_r2ai = row_count;
  delete from judge_scores;              get diagnostics n_js = row_count;
  delete from judge_questions;           get diagnostics n_jq = row_count;
  delete from round2_states;             get diagnostics n_r2s = row_count;
  delete from round2_assignments;        get diagnostics n_r2a = row_count;
  delete from activity_logs where event_type in ('submission', 'tab_hidden', 'tab_visible', 'window_blur', 'paste_blocked');
  get diagnostics n_logs = row_count;
  delete from announcements;             get diagnostics n_ann = row_count;

  update rounds set status = 'not_started', round_start_at = null, round_end_at = null, paused_at = null, total_paused_seconds = 0;

  v := jsonb_build_object('assignments', n_asg, 'submissions', n_sub, 'submission_versions', n_ver, 'evaluation_jobs', n_jobs,
    'ai_evaluations', n_ai, 'human_reviews', n_hr, 'round_results', n_rr, 'final_results', n_fr, 'round2_ai_evaluations', n_r2ai,
    'judge_scores', n_js, 'judge_questions', n_jq, 'round2_states', n_r2s, 'round2_assignments', n_r2a,
    'activity_logs', n_logs, 'announcements', n_ann);
  insert into admin_actions (admin_id, action, reason, new_value)
  values (p_admin, 'reset_competition', 'Reset Competition Data (Round 1 + Round 2)',
          jsonb_build_object('rounds', jsonb_build_array(1, 2), 'deleted', v));
  return jsonb_build_object('ok', true, 'rounds', jsonb_build_array(1, 2), 'deleted', v);
end $$;

-- Participant wipe, serialised with round start (fixes a race reported in review).
create or replace function clear_participants(p_admin uuid, p_confirm text)
returns jsonb language plpgsql set search_path = public as $$
declare v_deleted integer;
begin
  if coalesce(p_confirm, '') <> 'DELETE ALL PARTICIPANTS' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'confirmation_required', 'message', 'Type DELETE ALL PARTICIPANTS to confirm.');
  end if;
  perform 1 from rounds order by round_number for update;
  if exists (select 1 from rounds where status <> 'not_started') or exists (select 1 from challenge_assignments) then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'competition_data',
      'message', 'The competition has data. Reset Competition Data first; participants can only be cleared before a run.');
  end if;
  perform pg_advisory_xact_lock(hashtext('entries_entry_number'));
  delete from entries;
  get diagnostics v_deleted = row_count;
  insert into admin_actions (admin_id, action, old_value) values (p_admin, 'reset_participants', jsonb_build_object('deleted_count', v_deleted));
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end $$;

-- Organizer account deletion: "at least one admin" is checked under a lock
-- (fixes two admins deleting each other concurrently).
create or replace function delete_organizer_account(p_admin uuid, p_kind text, p_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare v_found boolean;
begin
  if p_id = p_admin then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'self', 'message', 'You can''t delete the account you are signed in with.');
  end if;
  perform pg_advisory_xact_lock(hashtext('organizer_accounts'));
  if p_kind = 'judge' then
    delete from judges where id = p_id returning true into v_found;
  else
    perform 1 from admins where role = 'admin' for update;
    if p_kind = 'admin' and (select count(*) from admins where role = 'admin' and id <> p_id) < 1 then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'last_admin', 'message', 'At least one admin account must remain.');
    end if;
    begin
      delete from admins where id = p_id and role = p_kind returning true into v_found;
    exception when foreign_key_violation then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'referenced',
        'message', 'This account is referenced by audit records and cannot be deleted. Reset its password instead.');
    end;
  end if;
  if not coalesce(v_found, false) then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found', 'message', 'Account not found.');
  end if;
  update auth_sessions set ended_at = now(), end_reason = 'account_deleted' where subject_id = p_id and ended_at is null;
  insert into admin_actions (admin_id, action, old_value) values (p_admin, 'delete_account', jsonb_build_object('kind', p_kind, 'id', p_id));
  return jsonb_build_object('ok', true);
end $$;

-- Admin edit of an entry: team name, disqualification and 1-2 members, atomically.
create or replace function update_entry(p_entry uuid, p_admin uuid, p_payload jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare v_members integer := jsonb_array_length(coalesce(p_payload -> 'members', '[]'::jsonb)); e entries;
begin
  if v_members < 1 or v_members > 2 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'team_size', 'message', 'A team has 1 or 2 members.');
  end if;
  select * into e from entries where id = p_entry for update;
  if not found then return jsonb_build_object('ok', false, 'status', 404, 'code', 'not_found', 'message', 'Entry not found.'); end if;
  update entries set team_name = nullif(trim(p_payload ->> 'team_name'), ''), is_team = v_members > 1,
         disqualified = coalesce((p_payload ->> 'disqualified')::boolean, disqualified),
         disqualified_reason = case when coalesce((p_payload ->> 'disqualified')::boolean, disqualified) then nullif(trim(p_payload ->> 'disqualified_reason'), '') else null end
   where id = p_entry;
  delete from team_members where entry_id = p_entry;
  insert into team_members (entry_id, member_position, full_name, email, phone, gender, college, city, branch, study_year)
  select p_entry, ord::integer, trim(m ->> 'full_name'), nullif(lower(trim(m ->> 'email')), ''), nullif(trim(m ->> 'phone'), ''),
         nullif(trim(m ->> 'gender'), ''), nullif(trim(m ->> 'college'), ''), nullif(trim(m ->> 'city'), ''),
         nullif(trim(m ->> 'branch'), ''), nullif(trim(m ->> 'study_year'), '')
    from jsonb_array_elements(p_payload -> 'members') with ordinality as t(m, ord);
  insert into admin_actions (admin_id, entry_id, action, old_value, new_value)
  values (p_admin, p_entry, 'edit_entry', jsonb_build_object('team_name', e.team_name, 'disqualified', e.disqualified),
          jsonb_build_object('team_name', p_payload ->> 'team_name', 'members', v_members, 'disqualified', p_payload -> 'disqualified'));
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- Privileges
-- =====================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_challenge_snapshot', '_round1_rules', '_slot_eligible', 'round1_preflight', '_round1_assign_missing',
                         '_round1_assign_error', 'round1_control', 'student_round1_state', 'student_autosave', 'student_advance',
                         'student_login_precheck', 'student_login', 'set_entry_pins', 'publish_challenge_import',
                         'competition_reset', 'clear_participants', 'delete_organizer_account', 'update_entry')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table challenge_import_batches from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table challenge_import_batches from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table challenge_import_batches to service_role; end if;
end $$;
