-- Rollback of 0007_round2_pack_jury_questions.sql.
-- Restores the 0006 versions of the Round 2 configuration, preflight, control,
-- jury scoring, final results and schema-status functions, then removes the
-- 0007 additions.
-- ⚠ Destroys: per-problem twists, categories/difficulty and sample prompts on
--   Round 2 problems, and per-question jury marks (each judge's total is kept,
--   the per-criterion columns stay 0 for question-mode scores). A saved Round 2
--   configuration that uses twist mode 'problem' or jury mode 'questions' must
--   be re-saved after rollback. Take a backup first.
begin;
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

drop function if exists round2_import_problems(uuid, jsonb, boolean);
drop function if exists _round2_jury_mode(jsonb);
alter table judge_scores drop column if exists question_scores;
alter table judge_scores drop column if exists max_total;
alter table round2_problems drop column if exists sample_prompt;
alter table round2_problems drop column if exists twist_description;
alter table round2_problems drop column if exists twist_title;
alter table round2_problems drop column if exists difficulty;
alter table round2_problems drop column if exists category;
commit;
