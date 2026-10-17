-- 0009: Round 1 feedback (one per team), required after the team's last Round 1 answer is locked.
-- Server-only (service role); RLS on with no policies. Removed with the entry (on delete cascade).
create table if not exists round1_feedback (
  entry_id uuid primary key references entries(id) on delete cascade,
  overall_rating smallint not null check (overall_rating between 1 and 5),
  system_rating smallint not null check (system_rating between 1 and 5),
  management_rating smallint not null check (management_rating between 1 and 5),
  challenge_level text not null check (challenge_level in ('too_easy', 'just_right', 'too_hard')),
  join_again text not null check (join_again in ('yes', 'maybe', 'no')),
  liked text not null check (char_length(liked) between 1 and 1000),
  suggestions text check (char_length(suggestions) <= 2000),
  submitted_at timestamptz not null default now()
);
alter table round1_feedback enable row level security;
revoke all on round1_feedback from anon, authenticated;
grant select, insert, update, delete on round1_feedback to service_role;
