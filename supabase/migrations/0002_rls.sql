-- Row Level Security
-- Strategy: the Next.js server uses the SECRET (service-role) key for all
-- privileged reads/writes via route handlers — the service role bypasses RLS
-- by design. RLS here is a defense-in-depth layer for the PUBLISHABLE
-- (anon) key, which is only used client-side for Supabase Realtime
-- subscriptions (no direct table reads/writes from the browser).
--
-- Practical effect: with RLS enabled and no permissive policy for the
-- anon role, the browser's anon key cannot read or write any table
-- directly. All data access goes through server route handlers, which
-- enforce entry-level scoping in application code (see src/lib/auth).

alter table admins enable row level security;
alter table judges enable row level security;
alter table entries enable row level security;
alter table team_members enable row level security;
alter table attendance enable row level security;
alter table event_settings enable row level security;
alter table event_access_codes enable row level security;
alter table rounds enable row level security;
alter table challenges enable row level security;
alter table challenge_assignments enable row level security;
alter table submissions enable row level security;
alter table submission_versions enable row level security;
alter table evaluation_jobs enable row level security;
alter table ai_evaluations enable row level security;
alter table human_reviews enable row level security;
alter table round_results enable row level security;
alter table round2_problems enable row level security;
alter table round2_assignments enable row level security;
alter table surprise_twists enable row level security;
alter table round2_states enable row level security;
alter table judge_questions enable row level security;
alter table judge_scores enable row level security;
alter table round2_ai_evaluations enable row level security;
alter table final_results enable row level security;
alter table activity_logs enable row level security;
alter table admin_actions enable row level security;
alter table announcements enable row level security;

-- Only a narrow, safe public read for the display screen: rounds status
-- and active announcements. Everything else has zero anon policies,
-- meaning "deny by default" for the browser's anon key.
create policy "public read round status" on rounds
  for select using (true);

create policy "public read active announcements" on announcements
  for select using (active = true);
