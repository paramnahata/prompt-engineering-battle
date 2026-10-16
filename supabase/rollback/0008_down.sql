-- Rollback of 0008: restores the audit-log foreign key without ON DELETE, the stored-PIN login check, the missing-PIN warning and schema status v7.
-- The 'where true' edits are harmless and are kept.
begin;
alter table admin_actions drop constraint if exists admin_actions_entry_id_fkey;
alter table admin_actions add constraint admin_actions_entry_id_fkey foreign key (entry_id) references entries(id);
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
end $function$

;
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
end $function$

;
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
  select jsonb_build_object('version', 7,
    'missingFunctions', coalesce((select jsonb_agg(f.name) from fn f
        where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.name)), '[]'::jsonb),
    'missingTables', coalesce((select jsonb_agg(t.name) from tb t where to_regclass('public.' || t.name) is null), '[]'::jsonb)
                     || coalesce((select jsonb_agg(c.tbl || '.' || c.name) from col c
                          where not exists (select 1 from information_schema.columns ic
                                             where ic.table_schema = 'public' and ic.table_name = c.tbl and ic.column_name = c.name)), '[]'::jsonb))
$function$

;
commit;
