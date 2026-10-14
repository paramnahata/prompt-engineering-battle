-- Rollback of 0006_round2_results_comms.sql.
-- ⚠ Destroys: Round 2 finalists, Round 2 AI jobs and overrides, announcement
--   targeting (all announcements become visible to everyone again), results
--   publication settings, Round 2 problem metadata (codes, private criteria).
-- Keeps: all Round 1 data, registrations, PINs, the challenge pool and the
--   original Round 2 tables from 0001. Take a backup first.
begin;
drop function if exists app_schema_status();
drop function if exists competition_reset_preview();
drop function if exists set_results_publication(uuid, text, jsonb);
drop function if exists student_results(uuid, uuid);
drop function if exists student_dashboard(uuid, uuid);
drop function if exists compute_final_results(uuid, boolean);
drop function if exists claim_round2_eval_jobs(integer, integer, integer);
drop function if exists jury_unlock_score(uuid, uuid, uuid);
drop function if exists jury_save_score(uuid, uuid, jsonb, text, boolean);
drop function if exists jury_ask_question(uuid, uuid, uuid, text);
drop function if exists student_round2_answer(uuid, uuid, uuid, text);
drop function if exists student_round2_save(uuid, uuid, text, jsonb);
drop function if exists student_round2_state(uuid, uuid);
drop function if exists round1_start_over(uuid, text);
drop function if exists round2_control(text, uuid, text);
drop function if exists round2_tick();
drop function if exists _round2_finalize_all(text);
drop function if exists _round2_finalize_entry(uuid, text);
drop function if exists _round2_assign(uuid);
drop function if exists round2_preflight();
drop function if exists round2_set_qualifiers(uuid, text, uuid[]);
drop function if exists round2_save_config(uuid, jsonb);
drop function if exists _round2_twist_snapshot(uuid);
drop function if exists _round2_problem_snapshot(uuid);
drop function if exists _round2_jury_max(jsonb);
drop function if exists _round2_config();
drop function if exists _round2_default_config();

drop table if exists round2_reviews;
drop table if exists round2_eval_jobs;
drop table if exists round2_qualifiers;
alter table final_results drop column if exists round2_jury, drop column if exists round2_ai, drop column if exists computed_by;
alter table round2_ai_evaluations drop column if exists model, drop column if exists rubric_version;
alter table judge_questions drop column if exists admin_id;
alter table round2_states drop column if exists started_at, drop column if exists initial_submitted_at, drop column if exists last_saved_at,
  drop column if exists twist_snapshot, drop column if exists submission_ref, drop column if exists auto_submitted;
alter table round2_assignments drop column if exists problem_snapshot;
alter table surprise_twists drop column if exists created_at, drop column if exists updated_at;
drop index if exists round2_problems_code_key;
alter table round2_problems drop column if exists problem_code, drop column if exists instructions, drop column if exists constraints,
  drop column if exists expected_output, drop column if exists evaluation_criteria, drop column if exists updated_at, drop column if exists updated_by;
drop policy if exists "public read active announcements" on announcements;
create policy "public read active announcements" on announcements for select using (active = true);
drop index if exists idx_announcements_active;
alter table announcements drop constraint if exists announcements_audience_check;
alter table announcements drop column if exists title, drop column if exists audience, drop column if exists entry_ids,
  drop column if exists updated_at, drop column if exists updated_by;
delete from event_settings where key = 'results_publication';
update rounds set config = '{}'::jsonb where round_number = 2 and status = 'not_started';

-- Restore the 0005 version of competition_reset (0006 replaced it).
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
revoke all on function competition_reset(uuid, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function competition_reset(uuid, text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function competition_reset(uuid, text) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function competition_reset(uuid, text) to service_role; end if;
end $$;
commit;
