-- Synthetic test data only. Never run against production.
insert into rounds (round_number, status, config) values
  (1, 'not_started', '{"challenge_seconds": 450, "round_duration_seconds": 1800}'),
  (2, 'not_started', '{"round_duration_seconds": 1800}')
on conflict (round_number) do nothing;
