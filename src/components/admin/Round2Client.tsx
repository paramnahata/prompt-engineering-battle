'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Play, Square, RotateCcw, Sparkles, Plus, Pencil, Trash2, Users, FileText, Shuffle } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { PageHeader, Panel, Stat } from '@/components/ui/Panel';
import { Badge, RoundStatusBadge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { Field, Toggle } from '@/components/ui/Field';
import { Tabs, TabsContent, TabsList } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';

const LOGIN = organizerLogin('/admin/round2');

type Criterion = { key: 'understanding' | 'response_quality' | 'adaptability' | 'interaction'; label: string; max: number };
interface Config {
  confirmed?: boolean; savedAt?: string;
  durationMinutes: number; problemMode: 'common' | 'random'; commonProblemId: string | null;
  twist: { enabled: boolean; mode: 'common' | 'random'; commonTwistId: string | null };
  jury: { enabled: boolean; criteria: Criterion[] };
  ai: { enabled: boolean; maxPoints: number };
  limits: { promptWords: number; outputChars: number; rationaleWords: number };
  final: { round1Weight: number; round2Weight: number };
}
interface Preflight { ok: boolean; errors: string[]; warnings: string[]; finalists: number; activeProblems: number; activeTwists: number; activeJudges: number; juryMax: number; config: Config }
interface ConfigVM { preflight: Preflight; problems: { id: string; problem_code: string | null; title: string; active: boolean }[]; twists: { id: string; title: string; active: boolean }[]; roundStatus: string }
interface Team {
  entryId: string; entryNumber: number | null; teamName: string | null; members: string[]; present: boolean; disqualified: boolean; source: string;
  round1Rank: number | null; round1Score: number | null;
  state: { state: string; last_saved_at: string | null; final_submitted_at: string | null; auto_submitted: boolean; submission_ref: string | null } | null;
  juryScores: number; juryLocked: number; juryAverage: number | null; questions: number; unanswered: number; aiJob: string | null;
}
interface StatusVM { serverNow: string; round: { status: string; round_start_at: string | null; round_end_at: string | null; paused_at: string | null } | null; teams: Team[] }

const STAGE: Record<string, { label: string; tone: Tone }> = {
  R2_WAITING: { label: 'Waiting', tone: 'neutral' }, INITIAL_PROMPT: { label: 'First attempt', tone: 'blue' }, OUTPUT: { label: 'First attempt locked', tone: 'violet' },
  SURPRISE_REVEALED: { label: 'Twist revealed', tone: 'amber' }, REFINEMENT: { label: 'Refining', tone: 'blue' }, FINAL_SUBMISSION: { label: 'Submitted', tone: 'green' },
  EVALUATION: { label: 'Evaluating', tone: 'violet' }, RESULT: { label: 'Result', tone: 'green' },
};

export default function Round2Client() {
  const toast = useToast();
  const [cfg, setCfg] = useState<ConfigVM | null>(null);
  const [status, setStatus] = useState<StatusVM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('control');

  const loadConfig = useCallback(async () => {
    setCfg(await api<ConfigVM>('/api/admin/round2/config', { loginPath: LOGIN }));
  }, []);
  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<StatusVM>('/api/admin/round2/status', { loginPath: LOGIN }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    }
  }, []);
  useEffect(() => { loadConfig().catch((e) => setError(errorMessage(e))); }, [loadConfig]);
  usePolling(loadStatus, 5000);

  const refreshAll = async () => { await Promise.all([loadConfig().catch(() => {}), loadStatus().catch(() => {})]); };
  const roundStatus = status?.round?.status ?? cfg?.roundStatus ?? null;

  return (
    <div>
      <PageHeader
        title="Round 2"
        description="Configure the final, choose finalists, run the round and follow every team live."
        meta={<><RoundStatusBadge status={roundStatus} />{cfg && <Badge tone={cfg.preflight.config.confirmed ? 'green' : 'amber'}>{cfg.preflight.config.confirmed ? 'Settings saved' : 'Settings not reviewed'}</Badge>}</>}
        actions={<Link href="/judge/dashboard" className="peb-btn-secondary">Open jury board</Link>}
      />
      {error && <Alert tone="error" className="mb-5">{error}</Alert>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList items={[
          { value: 'control', label: 'Run the round' },
          { value: 'settings', label: 'Settings' },
          { value: 'finalists', label: 'Finalists', count: cfg?.preflight.finalists },
          { value: 'problems', label: 'Problems', count: cfg?.problems.length },
          { value: 'twists', label: 'Surprise twists', count: cfg?.twists.length },
        ]} />
        <TabsContent value="control">
          <ControlTab cfg={cfg} status={status} onChanged={refreshAll} toast={toast} goTo={setTab} />
        </TabsContent>
        <TabsContent value="settings">
          {cfg ? <SettingsTab vm={cfg} onSaved={async () => { await loadConfig(); toast.success('Round 2 settings saved.'); }} /> : <SkeletonRows rows={6} />}
        </TabsContent>
        <TabsContent value="finalists"><FinalistsTab locked={roundStatus !== 'not_started'} onChanged={refreshAll} /></TabsContent>
        <TabsContent value="problems"><ProblemsTab onChanged={loadConfig} /></TabsContent>
        <TabsContent value="twists"><TwistsTab onChanged={loadConfig} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ControlTab({ cfg, status, onChanged, toast, goTo }: { cfg: ConfigVM | null; status: StatusVM | null; onChanged: () => Promise<void>; toast: ReturnType<typeof useToast>; goTo: (t: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'start' | 'stop' | 'reveal_twist' | 'reset'>(null);
  const round = status?.round;
  const st = round?.status;
  const left = useServerCountdown({ endAtIso: st === 'running' ? round?.round_end_at ?? null : null, serverNowIso: status?.serverNow ?? null });
  const pre = cfg?.preflight;
  const teams = status?.teams ?? [];
  const submitted = teams.filter((t) => t.state && ['FINAL_SUBMISSION', 'EVALUATION', 'RESULT'].includes(t.state.state)).length;

  const run = async (action: string, confirmText?: string) => {
    setBusy(action);
    try {
      const r = await api<Record<string, unknown>>('/api/admin/round2/control', { method: 'POST', body: { action, confirm: confirmText }, loginPath: LOGIN });
      const msg: Record<string, string> = {
        start: `Round 2 started for ${r.assigned} team(s).`, pause: 'Round 2 paused — the timer is frozen.', resume: `Resumed. The deadline moved by ${r.pausedSeconds}s.`,
        stop: `Round 2 ended. ${r.entriesFinalized} team(s) were submitted automatically.`, reveal_twist: `Twist revealed to ${r.revealed} team(s).`, reset: 'Round 2 was cleared. Finalists are kept.',
      };
      toast.success(msg[action] ?? 'Done.');
    } finally {
      setBusy(null);
      await onChanged();
      window.dispatchEvent(new Event('peb:rounds-changed'));
    }
  };
  const runSafely = (action: string) => run(action).catch((e) => toast.error(errorMessage(e)));

  return (
    <div className="space-y-6">
      <section className="peb-panel p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3"><h2 className="text-lg font-semibold text-white">Round controls</h2><RoundStatusBadge status={st} /></div>
            <p className="mt-1 max-w-xl text-sm text-muted">
              {st === 'not_started' && 'Starting gives every finalist their problem and starts one shared timer.'}
              {st === 'running' && (cfg?.preflight.config.twist.enabled ? 'Reveal the twist when you are ready; teams then refine and submit their final answer.' : 'Teams are working on their answer.')}
              {st === 'paused' && 'Everything is frozen. Resume to give the paused time back.'}
              {st === 'ended' && 'All work is locked. Score with the jury, run AI evaluation if enabled, then compute final results.'}
            </p>
          </div>
          {left !== null && <div className="text-left lg:text-right"><div className="font-display text-5xl font-semibold tabular text-white">{formatMMSS(left)}</div><div className="text-xs text-muted">time remaining</div></div>}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {st === 'not_started' && <Button variant="primary" icon={<Play className="h-4 w-4" />} disabled={!pre?.ok} loading={busy === 'start'} onClick={() => setConfirm('start')}>Start Round 2</Button>}
          {st === 'running' && <Button icon={<Pause className="h-4 w-4" />} loading={busy === 'pause'} onClick={() => void runSafely('pause')}>Pause</Button>}
          {st === 'paused' && <Button variant="primary" icon={<Play className="h-4 w-4" />} loading={busy === 'resume'} onClick={() => void runSafely('resume')}>Resume</Button>}
          {(st === 'running' || st === 'paused') && cfg?.preflight.config.twist.enabled && <Button icon={<Sparkles className="h-4 w-4" />} loading={busy === 'reveal_twist'} onClick={() => setConfirm('reveal_twist')}>Reveal twist</Button>}
          {(st === 'running' || st === 'paused') && <Button variant="danger" icon={<Square className="h-4 w-4" />} loading={busy === 'stop'} onClick={() => setConfirm('stop')}>Stop round</Button>}
          {st === 'ended' && <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'reset'} onClick={() => setConfirm('reset')}>Start over</Button>}
          {st === 'ended' && <Link href="/admin/results" className="peb-btn-primary">Go to results</Link>}
        </div>
        {st === 'not_started' && pre && (
          <div className="mt-5 space-y-2">
            {pre.errors.map((e) => <Alert key={e} tone="error">{e}</Alert>)}
            {pre.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
            {pre.ok && pre.errors.length === 0 && <Alert tone="success">Ready to start: {pre.finalists} finalist(s), {pre.config.problemMode === 'common' ? 'one common problem' : `${pre.activeProblems} problems shared out`}, {pre.config.durationMinutes} minutes.</Alert>}
            {!pre.config.confirmed && <Button size="sm" onClick={() => goTo('settings')}>Review settings</Button>}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Finalists" value={status ? teams.length : undefined} />
        <Stat label="Final answers in" value={status ? submitted : undefined} tone={teams.length && submitted === teams.length ? 'good' : 'default'} />
        <Stat label="Unanswered jury questions" value={status ? teams.reduce((a, t) => a + t.unanswered, 0) : undefined} />
        <Stat label="Jury scores locked" value={status ? teams.reduce((a, t) => a + t.juryLocked, 0) : undefined} hint={status ? `${teams.reduce((a, t) => a + t.juryScores, 0)} saved` : undefined} />
      </div>

      <Panel title="Live board" description="One row per finalist. Refreshes every 5 seconds." bodyClassName="p-0">
        {!status ? <div className="p-5"><SkeletonRows rows={5} /></div> : teams.length === 0 ? (
          <div className="p-5"><EmptyState icon={<Users className="h-6 w-6" />} title="No finalists yet" action={<Button size="sm" onClick={() => goTo('finalists')}>Choose finalists</Button>}>Pick finalists from the Round 1 ranking, or add teams by entry number.</EmptyState></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="peb-table min-w-[760px]">
              <thead><tr><th>Entry</th><th>Team</th><th>Stage</th><th>Last saved</th><th>Jury</th><th>Questions</th><th>AI</th></tr></thead>
              <tbody>
                {teams.map((t) => {
                  const s = t.state ? STAGE[t.state.state] : null;
                  return (
                    <tr key={t.entryId}>
                      <td className="font-display text-base font-semibold tabular text-white">{t.entryNumber}</td>
                      <td><div className="text-slate-100">{t.teamName || t.members[0] || '—'}</div><div className="text-xs text-muted">{t.members.join(', ')}{t.round1Rank ? ` · R1 rank ${t.round1Rank}` : ''}</div>
                        {!t.present && <Badge tone="amber" className="mt-1">Not checked in</Badge>}{t.disqualified && <Badge tone="red" className="mt-1">Disqualified</Badge>}</td>
                      <td>{s ? <Badge tone={s.tone}>{s.label}</Badge> : <span className="text-muted">Not started</span>}{t.state?.auto_submitted && <div className="mt-1 text-xs text-muted">auto-submitted</div>}</td>
                      <td className="text-xs text-muted">{t.state?.last_saved_at ? new Date(t.state.last_saved_at).toLocaleTimeString() : '—'}</td>
                      <td className="text-sm">{t.juryScores ? <>{t.juryAverage} <span className="text-xs text-muted">avg · {t.juryLocked}/{t.juryScores} locked</span></> : <span className="text-muted">—</span>}</td>
                      <td className="text-sm">{t.questions ? <>{t.questions}{t.unanswered ? <Badge tone="amber" className="ml-2">{t.unanswered} open</Badge> : null}</> : <span className="text-muted">—</span>}</td>
                      <td className="text-xs text-muted">{t.aiJob ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {st === 'ended' && cfg?.preflight.config.ai.enabled && <Round2Evaluation />}

      <ConfirmDialog open={confirm === 'start'} onOpenChange={(o) => !o && setConfirm(null)} title="Start Round 2?" confirmLabel="Start Round 2"
        onConfirm={() => run('start')}>
        <p>{pre?.finalists} finalist(s) will receive their problem and a {pre?.config.durationMinutes}-minute timer starts for everyone.</p>
        {pre?.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'reveal_twist'} onOpenChange={(o) => !o && setConfirm(null)} title="Reveal the surprise twist?" confirmLabel="Reveal twist"
        onConfirm={() => run('reveal_twist')}>
        <p>Every team that has not finished gets the twist now. Their first attempt is locked as-is and they continue in the refinement stage. This cannot be undone.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'stop'} onOpenChange={(o) => !o && setConfirm(null)} title="Stop Round 2 now?" tone="danger" confirmLabel="Stop and submit everything"
        onConfirm={() => run('stop')}>
        <p>The round ends immediately and every team&apos;s current work is submitted as their final answer.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'reset'} onOpenChange={(o) => !o && setConfirm(null)} title="Start Round 2 over?" tone="danger" confirmLabel="Clear Round 2" phrase="START OVER"
        onConfirm={(typed) => run('reset', typed)}>
        <p>Deletes all Round 2 work, jury questions and scores, Round 2 AI evaluations, overrides and final results. Finalists, problems, twists and settings are kept.</p>
      </ConfirmDialog>
    </div>
  );
}

function Round2Evaluation() {
  const toast = useToast();
  const [data, setData] = useState<{ counts: Record<string, number>; failed: { id: string; last_error: string | null; entry: { entry_number: number } | { entry_number: number }[] | null }[] } | null>(null);
  const [running, setRunning] = useState(false);
  const load = useCallback(async () => setData(await api('/api/admin/round2/evaluations', { loginPath: LOGIN })), []);
  usePolling(load, 8000);
  const runAll = async () => {
    setRunning(true);
    try {
      for (let i = 0; i < 30; i++) {
        const r = await api<{ remaining: number; claimed: number }>('/api/admin/round2/evaluations', { method: 'POST', body: { action: 'run' }, loginPath: LOGIN });
        await load();
        if (r.remaining === 0) break;
        if (r.claimed === 0) await new Promise((res) => setTimeout(res, 4000));
      }
      toast.success('Round 2 evaluation run finished.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  const c = data?.counts;
  return (
    <Panel title="Round 2 AI evaluation" description="Each final answer is evaluated once. Keep this page open while it runs."
      actions={<>
        {c?.failed ? <Button size="sm" onClick={() => api('/api/admin/round2/evaluations', { method: 'POST', body: { action: 'retry_failed' } }).then(load).catch((e) => toast.error(errorMessage(e)))}>Retry failed</Button> : null}
        <Button variant="primary" size="sm" loading={running} onClick={() => void runAll()} disabled={!c || (c.queued ?? 0) + (c.processing ?? 0) === 0}>Run evaluation</Button>
      </>}>
      <div className="flex flex-wrap gap-2 text-sm">
        {(['queued', 'processing', 'completed', 'failed'] as const).map((k) => <Badge key={k} tone={k === 'failed' && c?.failed ? 'red' : k === 'completed' ? 'green' : 'neutral'}>{k}: {c?.[k] ?? '—'}</Badge>)}
      </div>
      {data?.failed.length ? <ul className="mt-3 space-y-1 text-xs text-rose-200">{data.failed.map((f) => <li key={f.id}>Entry {(Array.isArray(f.entry) ? f.entry[0] : f.entry)?.entry_number}: {f.last_error}</li>)}</ul> : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
function NumberInput({ id, value, onChange, min, max, step = 1, suffix }: { id: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="number" className="peb-input w-28" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
      {suffix && <span className="text-sm text-muted">{suffix}</span>}
    </div>
  );
}

function SettingsTab({ vm, onSaved }: { vm: ConfigVM; onSaved: () => Promise<void> }) {
  const locked = vm.roundStatus === 'running' || vm.roundStatus === 'paused';
  const [c, setC] = useState<Config>(() => structuredClone(vm.preflight.config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setC(structuredClone(vm.preflight.config)); }, [vm.preflight.config]);
  const juryMax = c.jury.enabled ? c.jury.criteria.reduce((a, x) => a + (Number(x.max) || 0), 0) : 0;
  const r2Max = juryMax + (c.ai.enabled ? Number(c.ai.maxPoints) || 0 : 0);
  const finalMax = 200 * (Number(c.final.round1Weight) || 0) + r2Max * (Number(c.final.round2Weight) || 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { durationMinutes: c.durationMinutes, problemMode: c.problemMode, commonProblemId: c.problemMode === 'common' ? c.commonProblemId : null,
        twist: c.twist, jury: c.jury, ai: c.ai, limits: c.limits, final: c.final };
      await api('/api/admin/round2/config', { method: 'PUT', body, loginPath: LOGIN });
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setC((x) => ({ ...x, [k]: v }));

  return (
    <div className="space-y-5">
      {!vm.preflight.config.confirmed && <Alert tone="warning" title="These are suggested starting values, not your rules yet">Review each section and save. Round 2 cannot start until the settings are saved.</Alert>}
      {locked && <Alert tone="info">Round 2 is running, so settings are read-only.</Alert>}
      <fieldset disabled={locked} className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Time and problem">
            <div className="space-y-4">
              <Field id="r2-duration" label="Round length"><NumberInput id="r2-duration" value={c.durationMinutes} min={5} max={240} suffix="minutes" onChange={(n) => set('durationMinutes', n)} /></Field>
              <div>
                <span className="peb-label">Which problem do teams get?</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([['common', 'Same problem for everyone', FileText], ['random', 'Shared out from the active problems', Shuffle]] as const).map(([v, l, Icon]) => (
                    <button key={v} type="button" onClick={() => set('problemMode', v)} aria-pressed={c.problemMode === v}
                      className={`flex items-start gap-2 rounded-lg border p-3 text-left text-sm ${c.problemMode === v ? 'border-violet-400/60 bg-violet-500/10 text-white' : 'border-line text-slate-300 hover:border-slate-600'}`}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{l}
                    </button>
                  ))}
                </div>
              </div>
              {c.problemMode === 'common' && (
                <Field id="r2-problem" label="Common problem" help={vm.problems.length ? undefined : 'Add problems in the Problems tab first.'}>
                  <select id="r2-problem" className="peb-input" value={c.commonProblemId ?? ''} onChange={(e) => set('commonProblemId', e.target.value || null)}>
                    <option value="">Choose a problem…</option>
                    {vm.problems.map((p) => <option key={p.id} value={p.id} disabled={!p.active}>{p.problem_code ? `${p.problem_code} — ` : ''}{p.title}{p.active ? '' : ' (disabled)'}</option>)}
                  </select>
                </Field>
              )}
            </div>
          </Panel>
          <Panel title="Surprise twist" description="An optional mid-round change to the brief that tests adaptability.">
            <Toggle id="r2-twist" checked={c.twist.enabled} onChange={(v) => set('twist', { ...c.twist, enabled: v })} label="Use a surprise twist"
              description="Teams submit a first attempt; when you reveal the twist they refine it into their final answer." />
            {c.twist.enabled && (
              <div className="mt-3 space-y-3">
                <select aria-label="Twist mode" className="peb-input" value={c.twist.mode} onChange={(e) => set('twist', { ...c.twist, mode: e.target.value as 'common' | 'random' })}>
                  <option value="common">Same twist for everyone</option><option value="random">Shared out from the active twists</option>
                </select>
                {c.twist.mode === 'common' && (
                  <select aria-label="Common twist" className="peb-input" value={c.twist.commonTwistId ?? ''} onChange={(e) => set('twist', { ...c.twist, commonTwistId: e.target.value || null })}>
                    <option value="">Choose a twist…</option>
                    {vm.twists.map((t) => <option key={t.id} value={t.id} disabled={!t.active}>{t.title}{t.active ? '' : ' (disabled)'}</option>)}
                  </select>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Jury scoring" description={c.jury.enabled ? `Each judge scores out of ${juryMax}; teams get the average of their judges.` : 'Jury scoring is off.'}>
            <Toggle id="r2-jury" checked={c.jury.enabled} onChange={(v) => set('jury', { ...c.jury, enabled: v })} label="Judges score teams" />
            {c.jury.enabled && (
              <div className="mt-3 space-y-2">
                {c.jury.criteria.map((cr, i) => (
                  <div key={cr.key} className="flex items-center gap-2">
                    <input aria-label={`Criterion ${i + 1} name`} className="peb-input" value={cr.label} maxLength={60}
                      onChange={(e) => set('jury', { ...c.jury, criteria: c.jury.criteria.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <span className="text-xs text-muted">max</span>
                    <input aria-label={`Criterion ${i + 1} maximum`} type="number" className="peb-input w-20" min={0} max={100} value={cr.max}
                      onChange={(e) => set('jury', { ...c.jury, criteria: c.jury.criteria.map((x, j) => (j === i ? { ...x, max: Number(e.target.value) } : x)) })} />
                  </div>
                ))}
                <p className="peb-help">Set a maximum of 0 to leave a criterion out.</p>
              </div>
            )}
          </Panel>
          <Panel title="AI scoring" description="Optional. Gemini scores the final prompt and output on six criteria, scaled to the points below.">
            <Toggle id="r2-ai" checked={c.ai.enabled} onChange={(v) => set('ai', { ...c.ai, enabled: v })} label="Add an AI score" />
            {c.ai.enabled && <Field id="r2-ai-points" label="AI points" className="mt-3"><NumberInput id="r2-ai-points" value={c.ai.maxPoints} min={0} max={200} suffix="points" onChange={(n) => set('ai', { ...c.ai, maxPoints: n })} /></Field>}
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Answer limits">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="r2-pw" label="Prompt"><NumberInput id="r2-pw" value={c.limits.promptWords} min={20} max={5000} suffix="words" onChange={(n) => set('limits', { ...c.limits, promptWords: n })} /></Field>
              <Field id="r2-oc" label="AI output"><NumberInput id="r2-oc" value={c.limits.outputChars} min={100} max={50000} suffix="chars" onChange={(n) => set('limits', { ...c.limits, outputChars: n })} /></Field>
              <Field id="r2-rw" label="Explanation"><NumberInput id="r2-rw" value={c.limits.rationaleWords} min={0} max={3000} suffix="words" onChange={(n) => set('limits', { ...c.limits, rationaleWords: n })} /></Field>
            </div>
          </Panel>
          <Panel title="Final score" description="Final = Round 1 × weight + Round 2 × weight. Ties share a rank.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="r2-w1" label="Round 1 weight" help="Round 1 is out of 200"><NumberInput id="r2-w1" value={c.final.round1Weight} min={0} max={10} step={0.1} onChange={(n) => set('final', { ...c.final, round1Weight: n })} /></Field>
              <Field id="r2-w2" label="Round 2 weight" help={`Round 2 is out of ${r2Max}`}><NumberInput id="r2-w2" value={c.final.round2Weight} min={0} max={10} step={0.1} onChange={(n) => set('final', { ...c.final, round2Weight: n })} /></Field>
            </div>
            <p className="mt-4 text-sm text-slate-300">Maximum final score: <span className="font-semibold text-white tabular">{Math.round(finalMax * 10) / 10}</span></p>
          </Panel>
        </div>
      </fieldset>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex items-center gap-3">
        <Button variant="primary" loading={saving} disabled={locked} onClick={() => void save()}>Save settings</Button>
        {vm.preflight.config.savedAt && <span className="text-xs text-muted">Last saved {new Date(vm.preflight.config.savedAt).toLocaleString()}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
type RankRow = { entry_id: string; score: number; rank: number; qualified: boolean; entry: { entry_number: number; team_name: string | null; present: boolean; disqualified: boolean } | { entry_number: number; team_name: string | null; present: boolean; disqualified: boolean }[] | null };

function FinalistsTab({ locked, onChanged }: { locked: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [data, setData] = useState<{ finalists: { entry_id: string; source: string; round1_rank: number | null; round1_score: number | null }[]; ranking: RankRow[] } | null>(null);
  const [numbers, setNumbers] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => setData(await api('/api/admin/round2/finalists', { loginPath: LOGIN })), []);
  useEffect(() => { load().catch((e) => toast.error(errorMessage(e))); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const finalistIds = useMemo(() => new Set((data?.finalists ?? []).map((f) => f.entry_id)), [data]);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const r = await api<{ changed: number; total: number; assigned: number }>('/api/admin/round2/finalists', { method: 'POST', body: { action, ...extra }, loginPath: LOGIN });
      toast.success(action === 'from_round1' ? `${r.total} finalist(s) taken from Round 1 qualification.` : `Finalists updated (${r.total} total${r.assigned ? `, ${r.assigned} assigned now` : ''}).`);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const parsed = numbers.split(/[\s,]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  const one = (e: RankRow['entry']) => (Array.isArray(e) ? e[0] : e);

  return (
    <div className="space-y-5">
      {locked && <Alert tone="info">Round 2 has started. You can still add a late finalist (they get their problem immediately); removing finalists requires starting Round 2 over.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Panel title="Round 1 ranking" description="Teams marked qualified come from the qualification percentage used when Round 1 results were computed."
          actions={<Button variant="primary" size="sm" disabled={locked || !data?.ranking.length} loading={busy === 'from_round1'} onClick={() => void act('from_round1')}>Use Round 1 qualifiers</Button>} bodyClassName="p-0">
          {!data ? <div className="p-5"><SkeletonRows /></div> : data.ranking.length === 0 ? (
            <div className="p-5"><EmptyState title="No Round 1 results yet">Compute Round 1 results on the Results page, or add finalists by entry number.</EmptyState></div>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="peb-table">
                <thead><tr><th>Rank</th><th>Entry</th><th>Team</th><th>Score</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {data.ranking.map((r) => {
                    const e = one(r.entry);
                    const isF = finalistIds.has(r.entry_id);
                    return (
                      <tr key={r.entry_id}>
                        <td className="tabular">{r.rank}</td>
                        <td className="font-semibold tabular">{e?.entry_number}</td>
                        <td>{e?.team_name || '—'}</td>
                        <td className="tabular">{r.score}</td>
                        <td className="space-x-1">{r.qualified && <Badge tone="violet">Qualified</Badge>}{isF && <Badge tone="green">Finalist</Badge>}{e?.disqualified && <Badge tone="red">DQ</Badge>}</td>
                        <td className="text-right">
                          {isF ? <Button size="sm" variant="ghost" disabled={locked} onClick={() => void act('remove', { entryIds: [r.entry_id] })}>Remove</Button>
                            : <Button size="sm" variant="ghost" disabled={e?.disqualified} onClick={() => void act('add', { entryIds: [r.entry_id] })}>Add</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Add by entry number">
            <Field id="add-numbers" label="Entry numbers" help="Separate with commas or spaces.">
              <input id="add-numbers" className="peb-input" value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="12, 47, 103" inputMode="numeric" />
            </Field>
            <Button className="mt-3" size="sm" disabled={!parsed.length} loading={busy === 'add'} onClick={() => void act('add', { entryNumbers: parsed }).then(() => setNumbers(''))}>Add {parsed.length || ''} finalist{parsed.length === 1 ? '' : 's'}</Button>
          </Panel>
          <Panel title="Current finalists" description={`${data?.finalists.length ?? 0} team(s)`}
            actions={<Button size="sm" variant="ghost" disabled={locked || !data?.finalists.length} onClick={() => window.confirm('Remove every finalist?') && void act('clear')}>Clear all</Button>}>
            <p className="text-sm text-muted">{data?.finalists.filter((f) => f.source === 'manual').length ?? 0} added manually, {data?.finalists.filter((f) => f.source === 'round1').length ?? 0} from Round 1.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
interface Problem { id: string; problem_code: string | null; title: string; problem_statement: string; instructions: string | null; constraints: string | null; expected_output: string | null; evaluation_criteria: string | null; active: boolean; assigned: number }
const EMPTY_PROBLEM = { problem_code: '', title: '', problem_statement: '', instructions: '', constraints: '', expected_output: '', evaluation_criteria: '', active: true };

function ProblemsTab({ onChanged }: { onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [items, setItems] = useState<Problem[] | null>(null);
  const [editing, setEditing] = useState<(typeof EMPTY_PROBLEM & { id?: string }) | null>(null);
  const [deleting, setDeleting] = useState<Problem | null>(null);
  const load = useCallback(async () => setItems((await api<{ problems: Problem[] }>('/api/admin/round2/problems', { loginPath: LOGIN })).problems), []);
  useEffect(() => { load().catch((e) => toast.error(errorMessage(e))); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!editing) return;
    const { id, ...fields } = editing;
    await api('/api/admin/round2/problems', { method: id ? 'PATCH' : 'POST', body: id ? { id, ...fields } : fields, loginPath: LOGIN });
    toast.success(id ? 'Problem updated.' : 'Problem added.');
    setEditing(null);
    await Promise.all([load(), onChanged()]);
  };
  return (
    <Panel title="Round 2 problems" description="Teams receive a snapshot when the round starts, so later edits never change work in progress. Expected output and criteria are never shown to students."
      actions={<Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...EMPTY_PROBLEM })}>Add problem</Button>}>
      {!items ? <SkeletonRows /> : items.length === 0 ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No problems yet">Add the real-world problem(s) for the final.</EmptyState> : (
        <ul className="divide-y divide-line/60">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-white">{p.title}</span>{p.problem_code && <Badge>{p.problem_code}</Badge>}{!p.active && <Badge tone="amber">Disabled</Badge>}{p.assigned > 0 && <Badge tone="blue">Given to {p.assigned}</Badge>}</div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{p.problem_statement}</p>
              </div>
              <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing({ id: p.id, problem_code: p.problem_code ?? '', title: p.title, problem_statement: p.problem_statement, instructions: p.instructions ?? '', constraints: p.constraints ?? '', expected_output: p.expected_output ?? '', evaluation_criteria: p.evaluation_criteria ?? '', active: p.active })}>Edit</Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleting(p)}>{p.assigned ? 'Disable' : 'Delete'}</Button>
            </li>
          ))}
        </ul>
      )}
      <EditorModal open={!!editing} title={editing?.id ? 'Edit problem' : 'Add problem'} onClose={() => setEditing(null)} onSave={save}
        valid={!!editing?.problem_code.trim() && !!editing?.title.trim() && !!editing?.problem_statement.trim()}>
        {editing && <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field id="p-code" label="Problem ID"><input id="p-code" className="peb-input" value={editing.problem_code} maxLength={40} onChange={(e) => setEditing({ ...editing, problem_code: e.target.value })} /></Field>
            <Field id="p-title" label="Title"><input id="p-title" className="peb-input" value={editing.title} maxLength={200} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
          </div>
          {([['problem_statement', 'Problem statement (shown to teams)', 6], ['instructions', 'Instructions (shown to teams)', 3], ['constraints', 'Constraints (shown to teams)', 3], ['expected_output', 'Expected output (jury and AI only)', 4], ['evaluation_criteria', 'Evaluation criteria (jury and AI only)', 3]] as const).map(([k, l, rows]) => (
            <Field key={k} id={`p-${k}`} label={l}><textarea id={`p-${k}`} rows={rows} className="peb-input" value={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} /></Field>
          ))}
          <Toggle id="p-active" checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} label="Active" description="Only active problems can be chosen or shared out." />
        </div>}
      </EditorModal>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={deleting?.assigned ? 'Disable this problem?' : 'Delete this problem?'} tone="danger"
        confirmLabel={deleting?.assigned ? 'Disable' : 'Delete'} onConfirm={async () => {
          const r = await api<{ disabled?: boolean }>('/api/admin/round2/problems', { method: 'DELETE', body: { id: deleting!.id, confirm: 'DELETE' }, loginPath: LOGIN });
          toast.success(r.disabled ? 'Problem disabled (it was already given to teams).' : 'Problem deleted.');
          await Promise.all([load(), onChanged()]);
        }}>
        <p>{deleting?.assigned ? 'This problem was given to teams, so it is kept for history and disabled instead.' : `“${deleting?.title}” will be removed permanently.`}</p>
      </ConfirmDialog>
    </Panel>
  );
}

interface Twist { id: string; title: string; description: string; active: boolean }
function TwistsTab({ onChanged }: { onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [items, setItems] = useState<Twist[] | null>(null);
  const [editing, setEditing] = useState<{ id?: string; title: string; description: string; active: boolean } | null>(null);
  const load = useCallback(async () => setItems((await api<{ twists: Twist[] }>('/api/admin/round2/twists', { loginPath: LOGIN })).twists), []);
  useEffect(() => { load().catch((e) => toast.error(errorMessage(e))); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!editing) return;
    const { id, ...f } = editing;
    await api('/api/admin/round2/twists', { method: id ? 'PATCH' : 'POST', body: id ? { id, ...f } : f, loginPath: LOGIN });
    toast.success(id ? 'Twist updated.' : 'Twist added.');
    setEditing(null);
    await Promise.all([load(), onChanged()]);
  };
  const remove = async (t: Twist) => {
    if (!window.confirm(`Delete “${t.title}”? A twist already revealed to teams is disabled instead.`)) return;
    try {
      await api('/api/admin/round2/twists', { method: 'DELETE', body: { id: t.id, confirm: 'DELETE' }, loginPath: LOGIN });
      await Promise.all([load(), onChanged()]);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Panel title="Surprise twists" description="Only used when twists are enabled in Settings."
      actions={<Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ title: '', description: '', active: true })}>Add twist</Button>}>
      {!items ? <SkeletonRows /> : items.length === 0 ? <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No twists yet">A twist changes the brief mid-round, for example “the budget is halved”.</EmptyState> : (
        <ul className="divide-y divide-line/60">
          {items.map((t) => (
            <li key={t.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium text-white">{t.title}</span>{!t.active && <Badge tone="amber">Disabled</Badge>}</div><p className="mt-1 text-sm text-muted">{t.description}</p></div>
              <Button size="sm" variant="ghost" onClick={() => setEditing({ ...t })}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(t)}>Delete</Button>
            </li>
          ))}
        </ul>
      )}
      <EditorModal open={!!editing} title={editing?.id ? 'Edit twist' : 'Add twist'} onClose={() => setEditing(null)} onSave={save} valid={!!editing?.title.trim() && !!editing?.description.trim()}>
        {editing && <div className="space-y-4">
          <Field id="t-title" label="Title"><input id="t-title" className="peb-input" value={editing.title} maxLength={200} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
          <Field id="t-desc" label="What changes for the teams"><textarea id="t-desc" rows={5} className="peb-input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
          <Toggle id="t-active" checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} label="Active" />
        </div>}
      </EditorModal>
    </Panel>
  );
}

function EditorModal({ open, title, onClose, onSave, valid, children }: { open: boolean; title: string; onClose: () => void; onSave: () => Promise<void>; valid: boolean; children: React.ReactNode }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) setError(null); }, [open]);
  return (
    <Modal open={open} onOpenChange={(o) => !o && !saving && onClose()} title={title} size="lg"
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!valid} onClick={async () => { setSaving(true); setError(null); try { await onSave(); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); } }}>Save</Button></>}>
      {children}
      {error && <Alert tone="error" className="mt-4">{error}</Alert>}
    </Modal>
  );
}
