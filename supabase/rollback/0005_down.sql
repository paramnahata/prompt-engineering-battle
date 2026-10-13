-- Rollback of 0005_pins_pool_reset.sql.
-- ⚠ Destroys: team PIN hashes, challenge pool status / import history,
--   assignment snapshots, assignment rules. Run only if you must; the
--   preferred rollback is redeploying the previous app version (0004/0005
--   are additive and the previous code keeps working with them applied).
-- After running this, re-run 0004_event_readiness.sql to restore the 0004
-- versions of round1_control / student_* / student_login functions.
begin;
drop function if exists student_login_precheck(integer, text);
drop function if exists student_login(integer, boolean, boolean, text, uuid, integer, integer);
drop function if exists set_entry_pins(jsonb, uuid, boolean);
drop function if exists publish_challenge_import(uuid, uuid, text, text, jsonb);
drop function if exists competition_reset(uuid, text);
drop function if exists clear_participants(uuid, text);
drop function if exists delete_organizer_account(uuid, text, uuid);
drop function if exists update_entry(uuid, uuid, jsonb);
drop function if exists round1_preflight();
drop function if exists _slot_eligible(challenges, jsonb, integer);
drop function if exists _round1_rules();
drop function if exists _challenge_snapshot(uuid);

drop table if exists challenge_import_batches;
alter table challenge_assignments drop column if exists challenge_snapshot;
drop index if exists idx_challenges_pool;
drop index if exists idx_challenges_category_lower;
alter table challenges drop constraint if exists challenges_pool_status_check;
alter table challenges drop column if exists pool_status;
alter table challenges drop column if exists updated_at;
alter table challenges drop column if exists updated_by;
alter table challenges drop column if exists source_batch_id;
alter table challenges drop column if exists source_ref;
-- The wider difficulty constraint (adds expert/unrated) is kept so existing rows stay valid.
alter table entries drop column if exists pin_hash;
alter table entries drop column if exists pin_set_at;
alter table entries drop column if exists pin_set_by;
delete from event_settings where key = 'round1_assignment_rules';
commit;
