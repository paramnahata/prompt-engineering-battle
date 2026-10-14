'use client';

import { useCallback, useEffect, useState } from 'react';
import { Database, Download, KeyRound, RefreshCw, ShieldAlert, Timer } from 'lucide-react';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, SkeletonRows } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

const LOGIN = organizerLogin('/admin/settings');
interface Health { ok: boolean; database: string; schemaVersion: number | null; missingFunctions?: string[]; missingTables?: string[]; missingEnv?: string[]; missingRecommendedEnv?: string[]; checkedAt: string }
interface R1 { status: string; challengeSeconds: number; roundDurationSeconds: number; qualificationPercent: number }
interface Preview { clear: Record<string, number>; keep: Record<string, number>; rounds: Record<string, string>; blocked: boolean }

const CLEAR_LABELS: Record<string, string> = {
  round1Assignments: 'Round 1 challenge assignments', round1Submissions: 'Round 1 answers', evaluationJobs: 'Evaluation jobs', aiEvaluations: 'AI evaluations',
  scoreOverrides: 'Score overrides', round1Results: 'Round 1 results', round2Finalists: 'Round 2 finalists', round2Work: 'Round 2 work',
  juryQuestions: 'Jury questions', juryScores: 'Jury scores', finalResults: 'Final results', announcements: 'Announcements',
};
const KEEP_LABELS: Record<string, string> = {
  entries: 'Registered teams', members: 'Participants', checkedIn: 'Check-ins', withPin: 'Team PINs', challenges: 'Challenge pool',
  round2Problems: 'Round 2 problems', twists: 'Surprise twists', organizers: 'Organizer and judge accounts',
};
const EXPORTS: [string, string][] = [
  ['participants', 'Participants (no PINs)'], ['logins', 'Login activity'], ['round1_results', 'Round 1 ranking'], ['round1_answers', 'Round 1 answers & scores'],
  ['round2_work', 'Round 2 work'], ['jury_scores', 'Jury scores'], ['final_results', 'Final results'], ['audit_log', 'Audit log'],
];

export default function SettingsClient() {
  const toast = useToast();
  const [health, setHealth] = useState<Health | null>(null);
  const [r1, setR1] = useState<R1 | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadHealth = useCallback(async () => {
    const res = await fetch('/api/health', { cache: 'no-store' });
    setHealth(await res.json());
  }, []);
  const loadPreview = useCallback(async () => setPreview(await api<Preview>('/api/admin/competition/reset', { loginPath: LOGIN })), []);
  useEffect(() => {
    void loadHealth().catch(() => {});
    void api<R1>('/api/admin/round1/settings', { loginPath: LOGIN }).then(setR1).catch((e) => toast.error(errorMessage(e)));
    void loadPreview().catch(() => {});
  }, [loadHealth, loadPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveR1 = async () => {
    if (!r1) return;
    setSaving(true);
    try {
      await api('/api/admin/round1/settings', { method: 'PUT', body: { challengeSeconds: r1.challengeSeconds, roundDurationSeconds: r1.roundDurationSeconds, qualificationPercent: r1.qualificationPercent }, loginPath: LOGIN });
      toast.success('Round 1 settings saved.');
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };
  const r1Locked = r1?.status === 'running' || r1?.status === 'paused';

  return (
    <div className="space-y-6">
      <PageHeader title="Settings & health" description="Deployment checks, Round 1 timing, data exports and the competition reset." />

      <Panel title="Deployment health" description={health ? `Checked ${new Date(health.checkedAt).toLocaleTimeString()}` : undefined}
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void loadHealth()}>Check again</Button>}>
        {!health ? <SkeletonRows rows={2} /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span className="text-sm text-slate-200">Database</span>
              <Badge tone={health.database === 'ok' ? 'green' : 'red'}>{health.database === 'ok' ? `Up to date (schema v${health.schemaVersion})` : health.database.replace('_', ' ')}</Badge>
            </div>
            {!!health.missingFunctions?.length && <Alert tone="error" title="Missing database objects">Apply the pending migrations in <code>supabase/migrations</code> (see docs/EVENT_READINESS.md). Missing: {[...health.missingFunctions, ...(health.missingTables ?? [])].join(', ')}</Alert>}
            {!!health.missingEnv?.length && <Alert tone="error" title="Missing environment variables">{health.missingEnv.join(', ')}</Alert>}
            {!!health.missingRecommendedEnv?.length && <Alert tone="warning" title="Recommended environment variables not set">{health.missingRecommendedEnv.join(', ')} — set it in Vercel before issuing PINs.</Alert>}
            {health.ok && <p className="text-sm text-muted">All required environment variables are set. Values are never shown here.</p>}
          </div>
        )}
      </Panel>

      <Panel title="Round 1 timing and qualification" description={r1Locked ? 'Round 1 is running; timing is locked.' : 'Applies the next time Round 1 starts.'}>
        {!r1 ? <SkeletonRows rows={2} /> : (
          <fieldset disabled={r1Locked} className="flex flex-wrap items-end gap-4">
            <Field id="r1-ch" label="Time per challenge"><div className="flex items-center gap-2"><input id="r1-ch" type="number" min={60} max={3600} className="peb-input w-24" value={Math.round(r1.challengeSeconds / 60 * 10) / 10} step={0.5} onChange={(e) => setR1({ ...r1, challengeSeconds: Math.round(Number(e.target.value) * 60) })} /><span className="text-sm text-muted">min</span></div></Field>
            <Field id="r1-dur" label="Whole round"><div className="flex items-center gap-2"><input id="r1-dur" type="number" min={5} max={240} className="peb-input w-24" value={Math.round(r1.roundDurationSeconds / 60)} onChange={(e) => setR1({ ...r1, roundDurationSeconds: Math.round(Number(e.target.value) * 60) })} /><span className="text-sm text-muted">min</span></div></Field>
            <Field id="r1-q" label="Qualify for Round 2"><div className="flex items-center gap-2"><input id="r1-q" type="number" min={1} max={100} className="peb-input w-24" value={r1.qualificationPercent} onChange={(e) => setR1({ ...r1, qualificationPercent: Number(e.target.value) })} /><span className="text-sm text-muted">% top</span></div></Field>
            <Button variant="primary" icon={<Timer className="h-4 w-4" />} loading={saving} onClick={() => void saveR1()}>Save</Button>
          </fieldset>
        )}
      </Panel>

      <Panel id="audit" title="Exports" description="CSV files for spreadsheets. PINs are never exported. Every export is recorded in the audit log.">
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map(([type, label]) => <a key={type} className="peb-btn-secondary peb-btn-sm" href={`/api/admin/export?type=${type}`} download><Download className="h-3.5 w-3.5" aria-hidden="true" />{label}</a>)}
        </div>
      </Panel>

      <section className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5" aria-labelledby="danger-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 id="danger-title" className="flex items-center gap-2 text-base font-semibold text-rose-100"><ShieldAlert className="h-4 w-4" aria-hidden="true" />Reset competition data</h2>
            <p className="mt-1 text-sm text-rose-100/75">Clears everything from both rounds so you can run the event again (for example after a rehearsal). Registrations, PINs, check-ins, the challenge pool and accounts are kept.</p>
          </div>
          <Button variant="danger" disabled={!preview || preview.blocked} onClick={() => { void loadPreview(); setResetOpen(true); }}>Review and reset…</Button>
        </div>
        {preview?.blocked && <Alert tone="warning" className="mt-4">A round is running or paused. Stop it before resetting.</Alert>}
      </section>

      <ConfirmDialog open={resetOpen} onOpenChange={setResetOpen} title="Reset competition data?" tone="danger" confirmLabel="Reset everything listed" phrase="RESET COMPETITION"
        onConfirm={async (typed) => {
          await api('/api/admin/competition/reset', { method: 'POST', body: { confirm: typed }, loginPath: LOGIN });
          toast.success('Competition data reset. Both rounds are back to not started.');
          await loadPreview();
        }}>
        {preview ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold text-rose-200">Will be deleted</div>
              <ul className="space-y-1 text-sm">{Object.entries(preview.clear).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span>{CLEAR_LABELS[k] ?? k}</span><span className="tabular text-white">{v}</span></li>)}</ul>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-200"><KeyRound className="h-3.5 w-3.5" aria-hidden="true" />Will be kept</div>
              <ul className="space-y-1 text-sm">{Object.entries(preview.keep).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span>{KEEP_LABELS[k] ?? k}</span><span className="tabular text-white">{v}</span></li>)}</ul>
              <p className="mt-2 text-xs text-muted">Also kept: Common A/B, assignment rules, Round 2 settings, the Gemini key and the audit log.</p>
            </div>
          </div>
        ) : <SkeletonRows rows={4} />}
      </ConfirmDialog>
    </div>
  );
}
