-- Reconciles the repository with changes that were applied directly to the
-- production database (see supabase_migrations.schema_migrations:
-- add_challenge_limits_and_originality, attendance_consistency_trigger,
-- add_challenge_category_and_criteria, add_category_evaluation_notes_columns).
-- Every statement is idempotent, so this is a no-op on production and
-- brings a fresh database (local/staging) to the same shape.

alter table challenges add column if not exists prompt_word_limit integer not null default 150;
alter table challenges add column if not exists output_char_limit integer not null default 1500;
alter table challenges add column if not exists category text;
alter table challenges add column if not exists evaluation_criteria text;
alter table challenges add column if not exists evaluation_notes text;

alter table ai_evaluations add column if not exists originality_score numeric(4,1);
alter table ai_evaluations add column if not exists plagiarism_flag boolean not null default false;

create or replace function log_attendance_on_present_change() returns trigger as $$
begin
  if (tg_op = 'UPDATE' and old.present is distinct from new.present)
     or (tg_op = 'INSERT' and new.present = true) then
    insert into attendance (entry_id, status, marked_at)
    values (new.id, case when new.present then 'present' else 'absent' end, now());
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_log_attendance on entries;
create trigger trg_log_attendance
  after insert or update on entries
  for each row execute function log_attendance_on_present_change();
