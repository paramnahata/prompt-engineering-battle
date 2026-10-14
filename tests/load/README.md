# Load tests (k6)

Run **only against staging with synthetic data** — never production.

```bash
# 1. local staging stack (Postgres + PostgREST + next start + mock Gemini), 220 synthetic entries
tests/stack/start.sh 220
# 2. run (see tests/load/run-local.sh for the full sequence incl. DB verification)
tests/load/run-local.sh
```

Acceptance criteria (set before running):

| Scenario | Target |
|---|---|
| 200 simultaneous student logins | < 1% errors, p95 < 2 s |
| 200 students active (autosave ~5 s, status poll, heartbeat) | < 0.5% errors, p95 < 800 ms, p99 < 2 s |
| Organizer dashboard + desk during the round | p95 < 1.5 s |
| 200 simultaneous timer-expiry advances (each sent twice) | < 1% errors, p95 < 2.5 s, **zero** duplicate submissions/refs/jobs |
| AI evaluation (mock Gemini, 5% 429s) | every submission evaluated exactly once, failures visible |
