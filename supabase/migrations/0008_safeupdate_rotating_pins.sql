-- =====================================================================
-- 0008 — Supabase "safeupdate" compatibility + rotating team PINs.
--
-- 1. Supabase loads the pg-safeupdate extension for API connections, which
--    rejects any UPDATE or DELETE without a WHERE clause. Several functions
--    (Reset Competition Data, Delete all participants, Round 2 start over,
--    final results, finalists, publication) used unfiltered statements and
--    failed in production with "DELETE requires a WHERE clause". They are
--    re-created unchanged except for an explicit `where true`.
-- 2. Team PINs now rotate every 60 seconds and are derived by the app, so
--    student_login no longer requires a stored PIN hash and the Round 1
--    readiness check no longer warns about missing PINs.
-- 3. "Delete all participants" also failed because audit-log rows pointed at
--    the entries (admin_actions.entry_id had no ON DELETE rule). The audit
--    rows are now kept with entry_id set to NULL, like activity_logs.
-- Function bodies below are the 0007 definitions (pg_get_functiondef) with
-- only those edits; privileges are unchanged by CREATE OR REPLACE.
-- =====================================================================

alter table admin_actions drop constraint if exists admin_actions_entry_id_fkey;
alter table admin_actions add constraint admin_actions_entry_id_fkey
  foreign key (entry_id) references entries(id) on delete set null;

CREATE OR REPLACE FUNCTION public.clear_participants(p_admin uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  delete from entries where true;
  get diagnostics v_deleted = row_count;
  insert into admin_actions (admin_id, action, old_value) values (p_admin, 'reset_participants', jsonb_build_object('deleted_count', v_deleted));
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end $function$;

CREATE OR REPLACE FUNCTION public.competition_reset(p_admin uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  delete from challenge_assignments where true;
  delete from submissions where true;
  delete from round_results where true;             get diagnostics n_rr = row_count;
  delete from final_results where true;             get diagnostics n_fr = row_count;
  delete from round2_eval_jobs where true;          get diagnostics n_r2j = row_count;
  delete from round2_reviews where true;            get diagnostics n_r2rv = row_count;
  delete from round2_ai_evaluations where true;     get diagnostics n_r2ai = row_count;
  delete from judge_scores where true;              get diagnostics n_js = row_count;
  delete from judge_questions where true;           get diagnostics n_jq = row_count;
  delete from round2_states where true;             get diagnostics n_r2s = row_count;
  delete from round2_assignments where true;        get diagnostics n_r2a = row_count;
  delete from round2_qualifiers where true;         get diagnostics n_q = row_count;
  delete from activity_logs where event_type in ('submission', 'tab_hidden', 'tab_visible', 'window_blur', 'paste_blocked');
  get diagnostics n_logs = row_count;
  delete from announcements where true;             get diagnostics n_ann = row_count;

  update rounds set status = 'not_started', round_start_at = null, round_end_at = null, paused_at = null, total_paused_seconds = 0 where true;
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
end $function$;

CREATE OR REPLACE FUNCTION public.compute_final_results(p_admin uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  delete from final_results where true;
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
  select entry_id, r1, r2, jury, ai, final_score,
         rank() over (order by final_score desc, jury desc, ai desc, r1 desc), false, now(), p_admin
    from ranked;
  get diagnostics v_n = row_count;
  update event_settings set value = jsonb_set(value, '{final,published}', 'false'::jsonb), updated_at = now() where key = 'results_publication';
  insert into admin_actions (admin_id, action, new_value)
  values (p_admin, 'compute_final_results', jsonb_build_object('entries', v_n, 'forced', p_force, 'pendingAi', v_pending,
          'teamsWithoutJuryScore', v_missing, 'unlockedJuryScores', v_unlocked, 'weights', v_cfg -> 'final',
          'tieBreak', 'final, jury, ai, round1'));
  return jsonb_build_object('ok', true, 'entries', v_n);
end $function$;

CREATE OR REPLACE FUNCTION public.round2_control(p_action text, p_admin uuid, p_confirm text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r rounds; v_cfg jsonb; v_pre jsonb; v_n integer; v_delta interval; v_twist uuid; v_snap jsonb; s record;
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
    -- Per-problem twists: refuse up front (nothing changes) if any waiting team's problem has no twist.
    if v_cfg -> 'twist' ->> 'mode' = 'problem' and exists (
         select 1 from round2_states x join round2_assignments a on a.entry_id = x.entry_id
          where x.state in ('INITIAL_PROMPT', 'OUTPUT', 'R2_STARTED', 'JURY_PHASE')
            and coalesce(trim(a.problem_snapshot ->> 'twist_description'), '') = '') then
      return jsonb_build_object('ok', false, 'status', 409, 'code', 'no_twist',
        'message', 'At least one team''s problem has no twist. Nothing was revealed.');
    end if;
    v_n := 0;
    for s in select x.entry_id, a.problem_snapshot from round2_states x left join round2_assignments a on a.entry_id = x.entry_id
              where x.state in ('INITIAL_PROMPT', 'OUTPUT', 'R2_STARTED', 'JURY_PHASE') for update of x loop
      v_twist := null;
      if v_cfg -> 'twist' ->> 'mode' = 'problem' then
        v_snap := jsonb_build_object('id', null, 'source', 'problem',
                    'title', coalesce(nullif(trim(s.problem_snapshot ->> 'twist_title'), ''), 'The scenario changes'),
                    'description', s.problem_snapshot ->> 'twist_description');
      else
        if v_cfg -> 'twist' ->> 'mode' = 'common' then
          v_twist := nullif(v_cfg -> 'twist' ->> 'commonTwistId', '')::uuid;
        else
          select t.id into v_twist from surprise_twists t where t.active
           order by (select count(*) from round2_states x where x.twist_id = t.id), random() limit 1;
        end if;
        if v_twist is null then
          return jsonb_build_object('ok', false, 'status', 409, 'code', 'no_twist', 'message', 'No active surprise twist is available.');
        end if;
        v_snap := _round2_twist_snapshot(v_twist);
      end if;
      update round2_states set twist_id = v_twist, twist_snapshot = v_snap, twist_revealed_at = now(),
             initial_submitted_at = coalesce(initial_submitted_at, now()),
             final_prompt = coalesce(final_prompt, initial_prompt), final_output = coalesce(final_output, initial_output),
             state = 'SURPRISE_REVEALED', updated_at = now()
       where entry_id = s.entry_id;
      v_n := v_n + 1;
    end loop;
    insert into admin_actions (admin_id, action, new_value) values (p_admin, 'reveal_twist_round2', jsonb_build_object('revealed', v_n, 'mode', v_cfg -> 'twist' ->> 'mode'));
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
    delete from round2_eval_jobs where true; delete from round2_ai_evaluations where true; delete from round2_reviews where true;
    delete from judge_scores where true; delete from judge_questions where true; delete from round2_states where true; delete from round2_assignments where true;
    delete from final_results where true;
    update rounds set status = 'not_started', round_start_at = null, round_end_at = null, paused_at = null, total_paused_seconds = 0 where id = r.id;
    update event_settings set value = jsonb_set(value, '{final,published}', 'false'::jsonb), updated_at = now() where key = 'results_publication';
    update announcements set active = false where active and message like 'Round 2%';
    insert into admin_actions (admin_id, action, reason, old_value, new_value)
    values (p_admin, 'reset_round2', 'Start Over confirmed by admin', jsonb_build_object('status', r.status, 'teams', v_n), jsonb_build_object('status', 'not_started'));
    return jsonb_build_object('ok', true, 'roundStatus', 'not_started', 'teamsCleared', v_n);
  end if;
  return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_action', 'message', 'Unknown action.');
end $function$;

CREATE OR REPLACE FUNCTION public.round2_set_qualifiers(p_admin uuid, p_action text, p_entries uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    delete from round2_qualifiers where true;
    get diagnostics v_count = row_count;
  else
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'bad_action', 'message', 'Unknown action.');
  end if;
  insert into admin_actions (admin_id, action, new_value)
  values (p_admin, 'round2_qualifiers_' || p_action, jsonb_build_object('count', v_count, 'entries', to_jsonb(p_entries), 'assigned', v_assigned));
  return jsonb_build_object('ok', true, 'changed', v_count, 'assigned', v_assigned,
                            'total', (select count(*) from round2_qualifiers));
end $function$;

CREATE OR REPLACE FUNCTION public.set_results_publication(p_admin uuid, p_scope text, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  if p_scope = 'final' then update final_results set released = v_pub where true; end if;
  insert into admin_actions (admin_id, action, old_value, new_value)
  values (p_admin, 'results_publication_' || p_scope, v_old -> p_scope, v_scope);
  return jsonb_build_object('ok', true, 'settings', v_new);
end $function$;

CREATE OR REPLACE FUNCTION public.student_login(p_entry_number integer, p_code_ok boolean, p_pin_ok boolean, p_user_agent text, p_existing_sid uuid, p_ttl_seconds integer, p_active_window_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- Team PINs rotate every 60 s and are checked by the app (src/lib/auth/team-code.ts);
  -- no stored PIN is needed any more.
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
end $function$;

CREATE OR REPLACE FUNCTION public.round1_preflight()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  v_no_pin := 0; -- rotating team PINs: every entry can sign in once checked in

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
end $function$;

CREATE OR REPLACE FUNCTION public.app_schema_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with fn(name) as (values
    ('rate_limit_hit'), ('auth_session_validate'), ('student_login_precheck'), ('student_login'), ('round1_control'),
    ('round1_preflight'), ('student_round1_state'), ('student_autosave'), ('student_advance'), ('claim_evaluation_jobs'),
    ('compute_round1_results'), ('import_participants'), ('set_entry_pins'), ('publish_challenge_import'),
    ('competition_reset'), ('competition_reset_preview'), ('round2_control'), ('round2_preflight'), ('student_round2_state'),
    ('student_round2_save'), ('student_dashboard'), ('student_results'), ('compute_final_results'), ('set_results_publication'),
    ('round2_import_problems'), ('_round2_jury_mode')),
  tb(name) as (values ('auth_sessions'), ('rate_limits'), ('challenge_import_batches'), ('round2_qualifiers'), ('round2_eval_jobs'), ('round2_reviews')),
  col(tbl, name) as (values ('round2_problems', 'twist_description'), ('judge_scores', 'question_scores'))
  select jsonb_build_object('version', 8,
    'missingFunctions', coalesce((select jsonb_agg(f.name) from fn f
        where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.name)), '[]'::jsonb),
    'missingTables', coalesce((select jsonb_agg(t.name) from tb t where to_regclass('public.' || t.name) is null), '[]'::jsonb)
                     || coalesce((select jsonb_agg(c.tbl || '.' || c.name) from col c
                          where not exists (select 1 from information_schema.columns ic
                                             where ic.table_schema = 'public' and ic.table_name = c.tbl and ic.column_name = c.name)), '[]'::jsonb))
$function$

;
