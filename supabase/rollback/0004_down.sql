-- Rollback of 0004_event_readiness.sql (run 0005_down.sql first).
-- ⚠ Destroys: server-side sessions (everyone is signed out), rate-limit
--   counters, entry_number column (entry_code is kept), per-member
--   college/branch/etc., common-slot choices, evaluation bookkeeping columns.
begin;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('rate_limit_hit', 'auth_session_validate', '_student_session_ok', 'student_login',
                         '_round1_submit_entry', '_round1_finalize', 'round1_tick', '_round1_assign_missing', '_round1_assign_error',
                         'round1_control', 'student_round1_state', '_word_count', 'student_autosave', 'student_advance',
                         'claim_evaluation_jobs', 'compute_round1_results', 'admin_live_participants', 'import_participants')
  loop
    execute format('drop function if exists %s', f.sig);
  end loop;
end $$;
drop trigger if exists trg_entries_fill_entry_number on entries;
drop function if exists entries_fill_entry_number();
drop table if exists auth_sessions;
drop table if exists rate_limits;
drop index if exists entries_entry_number_key;
alter table entries drop constraint if exists entries_entry_number_positive;
alter table entries drop column if exists entry_number;
alter table team_members drop column if exists gender, drop column if exists college, drop column if exists city,
  drop column if exists branch, drop column if exists study_year, drop column if exists source_row;
drop index if exists challenges_common_slot_key;
alter table challenges drop constraint if exists challenges_common_slot_check;
alter table challenges drop column if exists common_slot;
alter table evaluation_jobs drop column if exists next_attempt_at, drop column if exists model, drop column if exists rubric_version;
alter table ai_evaluations drop column if exists model, drop column if exists rubric_version;
drop index if exists idx_assignments_round;
drop index if exists idx_submission_versions_recent;
drop index if exists idx_eval_jobs_claim;
drop index if exists idx_human_reviews_submission;
drop index if exists idx_activity_logs_entry_created;
drop index if exists idx_round_results_round_rank;
commit;
