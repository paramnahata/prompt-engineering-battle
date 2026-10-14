'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Square, UserPlus, Sparkles } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { PageHeader, Panel, Stat } from '@/components/ui/Panel';
import { Badge, RoundStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import LiveParticipantsPanel from './LiveParticipantsPanel';

const LOGIN = organizerLogin('/admin/round1');

interface StatusVM {
  serverNow: string;
  round: { status: string; round_start_at: string | null; round_end_at: string | null; paused_at: string | null; total_paused_seconds: number; config: Record<string, number> } | null;
  counts: { registered: number; present: number; submitted: number; evalQueued: number; evalProcessing: number; evalFailed: number; evaluated: number; qualified: number };
  commonChallenges: { common_slot: number; challenge_code: string; title: string }[];
}
type Action = 'start' | 'pause' | 'resume' | 'stop' | 'assign_missing' | 'reset';

const CONFIRM: Record<Action, { title: string; body: string; label: string; danger?: boolean; phrase?: string }> = {
  start: { title: 'Start Round 1?', body: 'Every checked-in team receives its four challenges and the official round timer starts.', label: 'Start Round 1' },
  pause: { title: 'Pause Round 1?', body: 'Every student timer freezes and saving is blocked until you resume. Resume gives back the paused time exactly.', label: 'Pause' },
  resume: { title: 'Resume Round 1?', body: 'Timers continue, extended by the time the round was paused.', label: 'Resume' },
  assign_missing: { title: 'Assign late arrivals?', body: 'Teams that checked in after the start receive their challenges now.', label: 'Assign challenges' },
  stop: { title: 'Stop Round 1 now?', body: 'The round ends for everyone and all unfinished answers are submitted as they are, then queued for AI evaluation. This cannot be undone.', label: 'Stop and submit everything', danger: true },
  reset: { title: 'Start Round 1 over?', body: 'Deletes Round 1 assignments, answers, evaluations, overrides and results. Registrations, PINs, check-ins and the challenge pool are kept. Not possible once Round 2 has started.', label: 'Clear Round 1', danger: true, phrase: 'START OVER' },
};

export default function AdminDashboardClient() {
  const toast = useToast();
  const [status, setStatus] = useState<StatusVM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<StatusVM>('/api/admin/round1/status', { loginPath: LOGIN }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Unable to refresh Round 1.'));
      throw e;
    }
  }, []);
  usePolling(load, 5000);

  const run = async (action: Action, confirmText?: string) => {
    try {
      const body = await api<Record<string, unknown>>('/api/admin/round1/control', { method: 'POST', body: { action, confirm: confirmText }, loginPath: LOGIN });
      const warnings = Array.isArray(body.warnings) && body.warnings.length ? ` Note: ${(body.warnings as string[]).join(' ')}` : '';
      const msg: Record<Action, string> = {
        start: `Round 1 started — ${body.assigned} team(s) received challenges.${warnings}`,
        pause: 'Round 1 paused. Every timer is frozen.',
        resume: `Resumed. Every timer was extended by ${body.pausedSeconds}s.`,
        assign_missing: body.assigned ? `Assigned challenges to ${body.assigned} late arrival(s).` : 'No checked-in team was missing challenges.',
        stop: `Round 1 ended. Answers from ${body.entriesFinalized} team(s) were submitted and queued for evaluation.`,
        reset: 'Round 1 cleared. It can be started again.',
      };
      toast.success(msg[action]);
    } finally {
      await load().catch(() => {});
      window.dispatchEvent(new Event('peb:rounds-changed'));
    }
  };

  const round = status?.round;
  const st = round?.status;
  const running = st === 'running';
  const paused = st === 'paused';
  const ended = st === 'ended';
  const notStarted = st === 'not_started';
  const left = useServerCountdown({ endAtIso: running ? round?.round_end_at ?? null : null, serverNowIso: status?.serverNow ?? null });
  const counts = status?.counts;
  const commons = status?.commonChallenges.slice().sort((a, b) => a.common_slot - b.common_slot) ?? [];
  const c = confirm ? CONFIRM[confirm] : null;

  return (
    <div>
      <PageHeader title="Round 1" description="Four timed prompt challenges per team. Every transition is enforced on the server, so a double click or a second organizer can’t break it."
        meta={<><RoundStatusBadge status={st} />{commons.length === 2 ? <Badge tone="blue">Commons: {commons.map((x) => x.challenge_code).join(' + ')}</Badge> : status && <Badge tone="amber">Commons not chosen</Badge>}</>}
        actions={<><Link href="/admin/challenges" className="peb-btn-secondary">Challenge pool</Link><Link href="/admin/results" className="peb-btn-secondary">Results</Link></>} />
      {error && <Alert tone="error" className="mb-5">{error}</Alert>}

      <section className="peb-panel mb-6 overflow-hidden">
        <div className="flex flex-col gap-6 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-white">Round controls</h2>
            <p className="mt-1 text-sm text-muted">
              {running && 'Live. Pause freezes every timer; Stop ends the round and submits all outstanding answers.'}
              {paused && 'Paused — all timers are frozen. Resume gives every team back the paused time.'}
              {ended && 'Closed. All answers are submitted. Run the AI evaluation below, then compute results on the Results page.'}
              {notStarted && 'Check attendance, PINs and the common challenges, then start.'}
              {!status && 'Loading…'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {notStarted && <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={() => setConfirm('start')}>Start Round 1</Button>}
              {running && <Button icon={<Pause className="h-4 w-4" />} onClick={() => setConfirm('pause')}>Pause</Button>}
              {paused && <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={() => setConfirm('resume')}>Resume</Button>}
              {(running || paused) && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setConfirm('assign_missing')}>Assign late arrivals</Button>}
              {(running || paused) && <Button variant="danger" icon={<Square className="h-4 w-4" />} onClick={() => setConfirm('stop')}>Stop round</Button>}
              {ended && <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm('reset')}>Start over</Button>}
            </div>
          </div>
          {left !== null && (
            <div className="lg:text-right">
              <div className="font-display text-6xl font-semibold leading-none tabular text-white">{formatMMSS(left)}</div>
              <div className="mt-1 text-sm text-muted">left in the round</div>
            </div>
          )}
          {paused && <div className="lg:text-right"><div className="font-display text-3xl font-semibold text-amber-200">Paused</div><div className="text-sm text-muted">since {round?.paused_at ? new Date(round.paused_at).toLocaleTimeString() : '—'}</div></div>}
        </div>
        {running && round?.round_start_at && round.round_end_at && left !== null && (
          <div className="h-1 bg-slate-800" aria-hidden="true">
            <div className="h-full bg-peb-gradient transition-[width] duration-1000" style={{ width: `${Math.max(0, Math.min(100, 100 - (left * 1000 / (new Date(round.round_end_at).getTime() - new Date(round.round_start_at).getTime())) * 100))}%` }} />
          </div>
        )}
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Registered" value={counts?.registered} />
        <Stat label="Checked in" value={counts?.present} />
        <Stat label="Answers submitted" value={counts?.submitted} />
        <Stat label="AI evaluated" value={counts?.evaluated} tone={counts?.evalFailed ? 'warn' : 'default'} hint={counts?.evalFailed ? `${counts.evalFailed} failed` : undefined} />
        <Stat label="Qualified" value={counts?.qualified} />
      </div>

      {notStarted && <PreflightPanel />}
      <div className="mb-6"><LiveParticipantsPanel /></div>
      <EvaluationPanel onChange={() => void load().catch(() => {})} counts={counts} />
      <p className="mt-6 text-sm text-muted">Need to clear both rounds after a rehearsal? Use <Link href="/admin/settings" className="text-cyan-300 hover:text-cyan-200">Settings → Reset competition data</Link>.</p>

      {c && confirm && (
        <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} title={c.title} confirmLabel={c.label} tone={c.danger ? 'danger' : 'primary'} phrase={c.phrase}
          onConfirm={(typed) => run(confirm, typed)}>
          <p>{c.body}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

interface PreflightVM { ok: boolean; errors: string[]; warnings: string[]; presentEntries: number; slot3Eligible: number; slot4Eligible: number; entriesWithoutPin: number; common: { slot: number; chosen: boolean; code?: string; difficulty?: string }[] }

function PreflightPanel() {
  const [p, setP] = useState<PreflightVM | null>(null);
  const loadPreflight = useCallback(async () => setP(await api<PreflightVM>('/api/admin/round1/preflight')), []);
  usePolling(loadPreflight, 15_000);
  if (!p) return null;
  return (
    <Panel className="mb-6" title="Readiness check" description="Start is refused by the server until every blocking item is fixed."
      actions={<Link href="/admin/challenges" className="text-sm text-cyan-300 hover:text-cyan-200">Pool & rules</Link>}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Checked in</dt><dd className="font-semibold tabular text-white">{p.presentEntries}</dd></div>
        {p.common.map((c) => <div key={c.slot}><dt className="text-muted">Common {c.slot === 1 ? 'A' : 'B'}</dt><dd className="font-semibold text-white">{c.chosen ? `${c.code} · ${c.difficulty}` : '—'}</dd></div>)}
        <div><dt className="text-muted">Eligible for slots 3 / 4</dt><dd className="font-semibold tabular text-white">{p.slot3Eligible} / {p.slot4Eligible}</dd></div>
      </dl>
      <div className="mt-4 space-y-2">
        {p.errors.map((e) => <Alert key={e} tone="error">{e}</Alert>)}
        {p.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
        {p.ok && p.warnings.length === 0 && <Alert tone="success">Ready to start.</Alert>}
      </div>
    </Panel>
  );
}

interface FailedJob {
  id: string; retry_count: number; last_error: string | null;
  submission: { id: string; entry: { id: string; entry_number: number; team_name: string | null } | null; assignment: { position: number } | null } | null;
}

function EvaluationPanel({ counts, onChange }: { counts: StatusVM['counts'] | undefined; onChange: () => void }) {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedJob[]>([]);
  const stopRef = useRef(false);
  const loadFailed = useCallback(async () => {
    const body = await api<{ failed: FailedJob[] }>('/api/admin/evaluations').catch(() => null);
    if (body) setFailed(body.failed ?? []);
  }, []);
  useEffect(() => { void loadFailed(); }, [loadFailed, counts?.evalFailed]);

  const start = async () => {
    stopRef.current = false;
    setRunning(true);
    let total = 0;
    try {
      for (;;) {
        if (stopRef.current) break;
        const body = await api<{ completed: number; remaining: number; retry: number; failed: number; claimed: number }>('/api/admin/evaluations', { method: 'POST', body: { action: 'run' }, loginPath: LOGIN });
        total += body.completed ?? 0;
        setLog(`Evaluated ${total} this session · ${body.remaining} remaining${body.retry ? ` · ${body.retry} rate-limited, retrying with backoff` : ''}${body.failed ? ` · ${body.failed} failed` : ''}`);
        onChange();
        if (!body.remaining) break;
        if (!body.claimed) await new Promise((r) => setTimeout(r, 10_000));
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Evaluation run failed.'));
    } finally {
      setRunning(false);
      void loadFailed();
      onChange();
    }
  };
  const retryFailed = async () => {
    try {
      const body = await api<{ requeued: number }>('/api/admin/evaluations', { method: 'POST', body: { action: 'retry_failed' }, loginPath: LOGIN });
      setLog(`Re-queued ${body.requeued} failed evaluation(s). Press Run evaluation.`);
    } catch (e) { toast.error(errorMessage(e)); }
    onChange();
    void loadFailed();
  };
  const pending = (counts?.evalQueued ?? 0) + (counts?.evalProcessing ?? 0);

  return (
    <Panel title="AI evaluation" description={counts ? `${counts.evaluated} evaluated · ${pending} waiting · ${counts.evalFailed} failed. Keep this page open while it runs.` : 'Loading…'}
      actions={<>
        {running ? <Button onClick={() => { stopRef.current = true; }}>Stop after this batch</Button>
          : <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} disabled={pending === 0} onClick={() => void start()}>Run evaluation</Button>}
        <Button disabled={running || !counts?.evalFailed} onClick={() => void retryFailed()}>Retry failed</Button>
      </>}>
      {log ? <p className="text-sm text-cyan-200" role="status">{log}</p> : <p className="text-sm text-muted">Each answer is evaluated exactly once. Rate limits back off and retry automatically.</p>}
      {failed.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="peb-table min-w-[560px]">
            <thead><tr><th>Entry</th><th>Challenge</th><th>Attempts</th><th>Last error</th></tr></thead>
            <tbody>
              {failed.map((j) => (
                <tr key={j.id}>
                  <td>{j.submission?.entry ? <Link className="text-cyan-300 hover:underline" href={`/admin/entries/${j.submission.entry.id}`}>{j.submission.entry.entry_number}</Link> : '—'}</td>
                  <td>{j.submission?.assignment?.position ?? '—'}</td>
                  <td className="tabular">{j.retry_count}</td>
                  <td className="text-xs text-rose-200">{j.last_error ?? 'Unknown error'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
