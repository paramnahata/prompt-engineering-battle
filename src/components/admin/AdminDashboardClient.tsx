'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import LiveParticipantsPanel from './LiveParticipantsPanel';

interface StatusVM {
  serverNow: string;
  round: { status: string; round_start_at: string | null; round_end_at: string | null; paused_at: string | null; total_paused_seconds: number; config: Record<string, number> } | null;
  counts: { registered: number; present: number; submitted: number; evalQueued: number; evalProcessing: number; evalFailed: number; evaluated: number; qualified: number };
  commonChallenges: { common_slot: number; challenge_code: string; title: string }[];
}

type Action = 'start' | 'pause' | 'resume' | 'stop' | 'reset' | 'assign_missing';

export default function AdminDashboardClient() {
  const [status, setStatus] = useState<StatusVM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/round1/status', { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/organizer/login?next=/admin/dashboard');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Unable to refresh the dashboard.');
      throw new Error('status');
    }
    setStatus(body);
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);
  usePolling(load, 5000);

  const run = async (action: Action, confirmText?: string, prompt?: string) => {
    if (busy) return;
    if (prompt && !window.confirm(prompt)) return;
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/round1/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, confirm: confirmText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not ${action.replace('_', ' ')} Round 1.`);
      if (action === 'start') setMessage(`Round 1 started — ${body.assigned} entries received challenges.`);
      if (action === 'assign_missing') setMessage(body.assigned ? `Assigned challenges to ${body.assigned} late arrival(s).` : 'No checked-in entries were missing challenges.');
      if (action === 'stop') setMessage(`Round 1 ended. Outstanding answers from ${body.entriesFinalized} entr${body.entriesFinalized === 1 ? 'y were' : 'ies were'} submitted and queued for evaluation.`);
      if (action === 'resume') setMessage(`Resumed. Every timer was extended by ${body.pausedSeconds}s of pause time.`);
      if (action === 'reset') setMessage(`Round 1 reset. ${body.assignmentsDeleted} assignments removed; registrations and attendance kept.`);
      setResetOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
      await load().catch(() => {});
    }
  };

  const round = status?.round;
  const roundStatus = round?.status ?? 'loading';
  const running = roundStatus === 'running';
  const paused = roundStatus === 'paused';
  const ended = roundStatus === 'ended';
  const notStarted = roundStatus === 'not_started';
  const commonReady = (status?.commonChallenges.length ?? 0) === 2;

  const roundSecondsLeft = useServerCountdown({
    endAtIso: running ? round?.round_end_at ?? null : null,
    serverNowIso: status?.serverNow ?? null,
  });

  const counts = status?.counts;
  const cards = [
    { label: 'Registered', value: counts?.registered },
    { label: 'Checked in', value: counts?.present },
    { label: 'Answers submitted', value: counts?.submitted },
    { label: 'AI evaluated', value: counts?.evaluated },
    { label: 'Qualified', value: counts?.qualified },
  ];

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-300">Event control center</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Admin Dashboard</h1>
        </div>
        <div className="text-xs text-muted" aria-live="polite">{lastUpdated ? `Live · updated ${lastUpdated}` : 'Connecting…'}</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 h-1 w-10 rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" />
            <div className="text-3xl font-bold tabular-nums text-white">{c.value ?? '—'}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>

      <section className="mb-6 rounded-3xl border border-white/10 bg-gradient-to-br from-violet-950/60 via-slate-900/80 to-cyan-950/40 p-5 sm:p-7" aria-labelledby="round-heading">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="round-heading" className="text-xl font-bold">Round 1 · Prompt Arena</h2>
              <StatusChip status={roundStatus} />
              {running && roundSecondsLeft !== null && <span className="font-mono text-lg tabular-nums text-white">{formatMMSS(roundSecondsLeft)} left</span>}
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              {running && 'Live. Students are working. Pause freezes every timer; Stop ends the round and submits all outstanding answers.'}
              {paused && 'Paused — all timers are frozen. Resume gives every student back the paused time.'}
              {ended && 'Closed. All answers are submitted. Run the AI evaluation below, then compute results.'}
              {notStarted && 'Check attendance and choose the two common challenges before starting.'}
            </p>
            {(notStarted || !commonReady) && status && (
              <p className={`mt-3 text-xs ${commonReady ? 'text-emerald-300' : 'text-amber-200'}`}>
                {commonReady
                  ? `Common challenges: ${status.commonChallenges.slice().sort((a, b) => a.common_slot - b.common_slot).map((c) => c.challenge_code).join(' + ')}`
                  : 'Common challenges are not set. '}
                <Link href="/admin/challenges" className="ml-1 underline">Challenge pool →</Link>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {notStarted && (
              <button className="peb-btn-primary min-w-36" disabled={!!busy || !commonReady} onClick={() => run('start', undefined, 'Start Round 1 now? Challenges are assigned to every checked-in entry and the official timer starts.')}>
                {busy === 'start' ? 'Starting…' : 'Start Round 1'}
              </button>
            )}
            {running && (
              <button className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 disabled:opacity-40" disabled={!!busy} onClick={() => run('pause', undefined, 'Pause Round 1? Every student timer freezes until you resume.')}>
                {busy === 'pause' ? 'Pausing…' : 'Pause'}
              </button>
            )}
            {paused && (
              <button className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-40" disabled={!!busy} onClick={() => run('resume', undefined, 'Resume Round 1 now?')}>
                {busy === 'resume' ? 'Resuming…' : 'Resume'}
              </button>
            )}
            {(running || paused) && (
              <>
                <button className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-40" disabled={!!busy} onClick={() => run('assign_missing', undefined, 'Assign challenges to entries that checked in after the start?')}>
                  {busy === 'assign_missing' ? 'Assigning…' : 'Assign late arrivals'}
                </button>
                <button className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40" disabled={!!busy} onClick={() => run('stop', undefined, 'STOP Round 1 now? The round ends for everyone and all unfinished answers are submitted as they are. This cannot be undone.')}>
                  {busy === 'stop' ? 'Stopping…' : 'Stop round'}
                </button>
              </>
            )}
            {ended && (
              <button className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 disabled:opacity-40" disabled={!!busy} onClick={() => setResetOpen(true)}>
                Start over…
              </button>
            )}
          </div>
        </div>
        {message && <div role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</div>}
        {error && <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      </section>

      {resetOpen && <ResetDialog busy={busy === 'reset'} onCancel={() => setResetOpen(false)} onConfirm={(text) => run('reset', text)} />}

      <LiveParticipantsPanel />

      <EvaluationPanel onChange={() => void load().catch(() => {})} counts={counts} />

      <ResultsPanel roundEnded={ended} />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { href: '/admin/entries', label: 'Entries & scores', desc: 'Prompts, outputs, AI scores, overrides' },
          { href: '/admin/challenges', label: 'Challenge pool', desc: 'Common challenges and active pool' },
          { href: '/admin/attendance', label: 'Registration desk', desc: 'Check-in, import, access code' },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.06]">
            <div className="font-semibold">{l.label} <span className="text-cyan-300 transition group-hover:translate-x-1" aria-hidden="true">→</span></div>
            <div className="mt-1 text-xs text-muted">{l.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const style =
    status === 'running' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
      : status === 'paused' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
        : status === 'ended' ? 'border-slate-400/30 bg-slate-400/10 text-slate-300'
          : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200';
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${style}`}>{status.replace('_', ' ')}</span>;
}

function ResetDialog({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (text: string) => void }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="reset-title" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="w-full max-w-md rounded-2xl border border-rose-400/30 bg-slate-950 p-6 shadow-2xl">
        <h2 id="reset-title" className="text-lg font-bold text-rose-200">Start Round 1 over?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">This permanently deletes, for Round 1:</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-300">
          <li>all challenge assignments and submitted answers</li>
          <li>draft history, AI evaluations and score overrides</li>
          <li>computed results and qualification</li>
        </ul>
        <p className="mt-3 text-sm text-emerald-200">Kept: participants, teams, attendance, accounts and the challenge pool.</p>
        <label htmlFor="reset-confirm" className="mt-4 block text-xs font-semibold text-slate-300">Type <span className="font-mono text-white">START OVER</span> to confirm</label>
        <input ref={inputRef} id="reset-confirm" className="mt-2 w-full rounded-lg border border-border bg-surface p-2 font-mono" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <div className="mt-5 flex justify-end gap-2">
          <button className="peb-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || text !== 'START OVER'} onClick={() => onConfirm(text)}>
            {busy ? 'Resetting…' : 'Erase Round 1 data'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FailedJob {
  id: string;
  retry_count: number;
  last_error: string | null;
  submission: { id: string; entry: { id: string; entry_number: number; team_name: string | null } | null; assignment: { position: number } | null } | null;
}

function EvaluationPanel({ counts, onChange }: { counts: StatusVM['counts'] | undefined; onChange: () => void }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedJob[]>([]);
  const stopRef = useRef(false);

  const loadFailed = useCallback(async () => {
    const res = await fetch('/api/admin/evaluations', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setFailed(body.failed ?? []);
  }, []);
  useEffect(() => { void loadFailed(); }, [loadFailed, counts?.evalFailed]);

  const start = async () => {
    stopRef.current = false;
    setRunning(true);
    setError(null);
    let total = 0;
    try {
      for (;;) {
        if (stopRef.current) break;
        const res = await fetch('/api/admin/evaluations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run' }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? 'Evaluation run failed.');
        total += body.completed ?? 0;
        setLog(`Evaluated ${total} this session · ${body.remaining} remaining${body.retry ? ` · ${body.retry} rate-limited, retrying with backoff` : ''}${body.failed ? ` · ${body.failed} failed` : ''}`);
        onChange();
        if (!body.remaining) break;
        if (!body.claimed) await new Promise((r) => setTimeout(r, 10_000)); // waiting on backoff
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation run failed.');
    } finally {
      setRunning(false);
      void loadFailed();
      onChange();
    }
  };

  const retryFailed = async () => {
    setError(null);
    const res = await fetch('/api/admin/evaluations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry_failed' }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? 'Could not re-queue failed evaluations.');
    else setLog(`Re-queued ${body.requeued} failed evaluation(s). Press Run evaluation.`);
    onChange();
    void loadFailed();
  };

  const pending = (counts?.evalQueued ?? 0) + (counts?.evalProcessing ?? 0);

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5" aria-labelledby="eval-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="eval-heading" className="font-semibold">AI evaluation (Gemini)</h2>
          <p className="mt-1 text-sm text-muted">
            {counts ? `${counts.evaluated} evaluated · ${pending} waiting · ${counts.evalFailed} failed` : 'Loading…'}. Keep this page open while it runs.
          </p>
        </div>
        <div className="flex gap-2">
          {running ? (
            <button className="peb-btn-secondary" onClick={() => { stopRef.current = true; }}>Stop after this batch</button>
          ) : (
            <button className="peb-btn-primary" disabled={pending === 0} onClick={() => void start()}>Run evaluation</button>
          )}
          <button className="peb-btn-secondary" disabled={running || !counts?.evalFailed} onClick={() => void retryFailed()}>Retry failed</button>
        </div>
      </div>
      {log && <p className="mt-3 text-xs text-cyan-200" role="status">{log}</p>}
      {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
      {failed.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-white/10 text-xs text-muted"><th className="py-2 pr-3">Entry</th><th className="py-2 pr-3">Challenge</th><th className="py-2 pr-3">Attempts</th><th className="py-2">Last error</th></tr></thead>
            <tbody>
              {failed.map((j) => (
                <tr key={j.id} className="border-b border-white/5 align-top">
                  <td className="py-2 pr-3">{j.submission?.entry ? <Link className="text-cyan-300 hover:underline" href={`/admin/entries/${j.submission.entry.id}`}>{j.submission.entry.entry_number}</Link> : '—'}</td>
                  <td className="py-2 pr-3">{j.submission?.assignment?.position ?? '—'}</td>
                  <td className="py-2 pr-3">{j.retry_count}</td>
                  <td className="py-2 text-xs text-rose-200">{j.last_error ?? 'Unknown error'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface ResultRow {
  score: number;
  rank: number;
  qualified: boolean;
  entry: { id: string; entry_number: number; team_name: string | null; team_members: { member_position: number; full_name: string }[] } | null;
}

function ResultsPanel({ roundEnded }: { roundEnded: boolean }) {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [percent, setPercent] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/results', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setRows(body.results ?? []);
      setPercent(body.qualificationPercent ?? 15);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const compute = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qualificationPercent: percent, force }) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === 'pending_evaluations') {
        setPendingWarning(body.error);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not compute results.');
      setPendingWarning(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not compute results.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5" aria-labelledby="results-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="results-heading" className="font-semibold">Round 1 results</h2>
          <p className="mt-1 text-sm text-muted">Sum of the four challenge scores (latest manual override wins). Ties at the cutoff all qualify. Admin-only.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted" htmlFor="qual-pct">Qualify top</label>
          <input id="qual-pct" type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-16 rounded-lg border border-border bg-surface p-2 text-sm" />
          <span className="text-xs text-muted">%</span>
          <button className="peb-btn-primary" disabled={!roundEnded || busy} onClick={() => void compute(false)}>{busy ? 'Computing…' : 'Compute results'}</button>
        </div>
      </div>
      {pendingWarning && (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm text-amber-100">
          {pendingWarning}
          <button className="ml-3 underline" onClick={() => void compute(true)} disabled={busy}>Compute anyway (missing scores count as 0)</button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
      {rows.length > 0 ? (
        <div className="mt-4 max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10 text-xs text-muted"><th className="py-2 pr-3">Rank</th><th className="py-2 pr-3">Entry</th><th className="py-2 pr-3">Team / participants</th><th className="py-2 pr-3 text-right">Score /200</th><th className="py-2">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entry?.id ?? r.rank} className="border-b border-white/5">
                  <td className="py-2 pr-3 tabular-nums">{r.rank}</td>
                  <td className="py-2 pr-3 font-medium">{r.entry ? <Link className="text-cyan-300 hover:underline" href={`/admin/entries/${r.entry.id}`}>{r.entry.entry_number}</Link> : '—'}</td>
                  <td className="py-2 pr-3">{r.entry?.team_name || r.entry?.team_members?.slice().sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name).join(', ') || '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(r.score).toFixed(1)}</td>
                  <td className="py-2">{r.qualified ? <span className="text-emerald-300">Qualified</span> : <span className="text-slate-500">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{roundEnded ? 'No results computed yet.' : 'Available after Round 1 ends.'}</p>
      )}
    </section>
  );
}
