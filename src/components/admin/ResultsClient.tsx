'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Download, Eye, EyeOff, Trophy } from 'lucide-react';
import { api, ApiError, errorMessage, organizerLogin } from '@/lib/client/api';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Toggle } from '@/components/ui/Field';
import { Tabs, TabsContent, TabsList } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { Podium, WINNER_PLACES } from '@/components/results/Podium';

const LOGIN = organizerLogin('/admin/results');
type Scope = 'round1' | 'final';
interface PubScope { published: boolean; showScore: boolean; showRank: boolean; showQualification?: boolean; showFeedback: boolean; showLeaderboard: boolean; leaderboardSize: number; publishedAt?: string; publishedBy?: string }
interface PubVM { settings: Record<Scope, PubScope>; publishers: { id: string; full_name: string; email: string }[] }
type EntryRef = { entry_number: number; team_name: string | null; team_members?: { member_position: number; full_name: string }[] };
interface R1Row { score: number; rank: number; qualified: boolean; computed_at: string; entry: EntryRef | EntryRef[] | null }
interface FinalRow { entry_id: string; round1_score: number; round2_score: number; round2_jury: number | null; round2_ai: number | null; final_score: number; rank: number; computed_at: string; entry: EntryRef | EntryRef[] | null }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const names = (e: EntryRef | null) => e?.team_name || (e?.team_members ?? []).sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name).join(' & ') || '—';

function tieRanks<T extends { rank: number }>(rows: T[]) {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
  return (rank: number) => (counts.get(rank) ?? 0) > 1;
}

export default function ResultsClient() {
  const [pub, setPub] = useState<PubVM | null>(null);
  const loadPub = useCallback(async () => setPub(await api<PubVM>('/api/admin/results/publication', { loginPath: LOGIN })), []);
  useEffect(() => { void loadPub().catch(() => {}); }, [loadPub]);
  return (
    <div>
      <PageHeader title="Results" description="Compute scores, review rankings and ties, then decide exactly what students can see. Nothing is visible to students until you publish it." />
      <Tabs defaultValue="round1">
        <TabsList items={[{ value: 'round1', label: 'Round 1' }, { value: 'final', label: 'Final & winners' }]} />
        <TabsContent value="round1"><Round1Results pub={pub} onPublished={loadPub} /></TabsContent>
        <TabsContent value="final"><FinalResults pub={pub} onPublished={loadPub} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Publication({ scope, pub, hasResults, onSaved }: { scope: Scope; pub: PubVM | null; hasResults: boolean; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const current = pub?.settings?.[scope];
  const [s, setS] = useState<PubScope | null>(current ?? null);
  const [confirm, setConfirm] = useState<null | 'publish' | 'unpublish'>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (current) setS({ ...current }); }, [current]);
  if (!s || !current) return <Panel title="Student visibility"><SkeletonRows rows={3} /></Panel>;
  const by = pub?.publishers.find((p) => p.id === current.publishedBy);
  const save = async (extra: Partial<PubScope> = {}) => {
    const settings = { showScore: s.showScore, showRank: s.showRank, showFeedback: s.showFeedback, showLeaderboard: s.showLeaderboard, leaderboardSize: s.leaderboardSize,
      ...(scope === 'round1' ? { showQualification: s.showQualification ?? true } : {}), ...extra };
    await api('/api/admin/results/publication', { method: 'PUT', body: { scope, settings }, loginPath: LOGIN });
    await onSaved();
  };
  const saveOptions = async () => { setSaving(true); try { await save(); toast.success('Visibility options saved.'); } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); } };
  return (
    <Panel title="Student visibility" description={current.published ? `Published${current.publishedAt ? ` ${new Date(current.publishedAt).toLocaleString()}` : ''}${by ? ` by ${by.full_name}` : ''}.` : 'Not published — students see “results are not out yet”.'}
      actions={current.published
        ? <Button variant="danger" size="sm" icon={<EyeOff className="h-4 w-4" />} onClick={() => setConfirm('unpublish')}>Unpublish</Button>
        : <Button variant="primary" size="sm" icon={<Eye className="h-4 w-4" />} disabled={!hasResults} onClick={() => setConfirm('publish')}>Publish to students</Button>}>
      <div className="divide-y divide-line/60">
        <Toggle id={`${scope}-score`} checked={s.showScore} onChange={(v) => setS({ ...s, showScore: v })} label="Show scores" />
        <Toggle id={`${scope}-rank`} checked={s.showRank} onChange={(v) => setS({ ...s, showRank: v })} label="Show each team its rank" />
        {scope === 'round1' && <Toggle id={`${scope}-qual`} checked={s.showQualification ?? true} onChange={(v) => setS({ ...s, showQualification: v })} label="Show whether the team qualified for Round 2" />}
        <Toggle id={`${scope}-fb`} checked={s.showFeedback} onChange={(v) => setS({ ...s, showFeedback: v })} label="Show AI feedback" description="The AI judge’s one-sentence summary for each answer." />
        <Toggle id={`${scope}-lb`} checked={s.showLeaderboard} onChange={(v) => setS({ ...s, showLeaderboard: v })} label="Show a leaderboard" description="Entry numbers and team names of the top teams." />
        {s.showLeaderboard && (
          <div className="py-2"><Field id={`${scope}-lbn`} label="Leaderboard size"><input id={`${scope}-lbn`} type="number" min={1} max={100} className="peb-input w-24" value={s.leaderboardSize} onChange={(e) => setS({ ...s, leaderboardSize: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} /></Field></div>
        )}
      </div>
      <Button className="mt-4" size="sm" loading={saving} onClick={() => void saveOptions()}>Save options</Button>
      <ConfirmDialog open={confirm === 'publish'} onOpenChange={(o) => !o && setConfirm(null)} title="Publish results to students?" confirmLabel="Publish"
        onConfirm={async () => { await save({ published: true }); toast.success('Results published.'); }}>
        <p>Every team will see their result on their dashboard{s.showLeaderboard ? `, plus a top-${s.leaderboardSize} leaderboard` : ''}. Your name is recorded as the publisher.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'unpublish'} onOpenChange={(o) => !o && setConfirm(null)} title="Hide results from students?" tone="danger" confirmLabel="Unpublish"
        onConfirm={async () => { await save({ published: false }); toast.success('Results hidden from students.'); }}>
        <p>Students will no longer see these results until you publish again.</p>
      </ConfirmDialog>
    </Panel>
  );
}

function ExportLink({ type, children }: { type: string; children: React.ReactNode }) {
  return <a className="peb-btn-secondary peb-btn-sm" href={`/api/admin/export?type=${type}`} download><Download className="h-3.5 w-3.5" aria-hidden="true" />{children}</a>;
}

function Round1Results({ pub, onPublished }: { pub: PubVM | null; onPublished: () => Promise<void> }) {
  const toast = useToast();
  const [data, setData] = useState<{ results: R1Row[]; qualificationPercent: number } | null>(null);
  const [percent, setPercent] = useState(15);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const load = useCallback(async () => {
    const d = await api<{ results: R1Row[]; qualificationPercent: number }>('/api/admin/results', { loginPath: LOGIN });
    setData(d);
    setPercent(d.qualificationPercent);
  }, []);
  useEffect(() => { void load().catch((e) => toast.error(errorMessage(e))); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const compute = async (force = false) => {
    setBusy(true);
    try {
      const r = await api<{ entries: number; qualified: number }>('/api/admin/results', { method: 'POST', body: { qualificationPercent: percent, force }, loginPath: LOGIN });
      toast.success(`Ranked ${r.entries} entries; ${r.qualified} qualified.`);
      setPending(null);
      await Promise.all([load(), onPublished()]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'pending_evaluations') setPending(Number(e.body?.pending ?? 0));
      else toast.error(errorMessage(e));
    } finally { setBusy(false); }
  };
  const rows = useMemo(() => data?.results ?? [], [data]);
  const isTie = useMemo(() => tieRanks(rows), [rows]);
  const qualified = rows.filter((r) => r.qualified).length;
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-5">
        <Panel title="Compute Round 1 results" description="Score per entry = sum of four challenges (each out of 50; the latest manual override wins). Ties at the cutoff all qualify.">
          <div className="flex flex-wrap items-end gap-3">
            <Field id="q-pct" label="Qualify the top"><div className="flex items-center gap-2"><input id="q-pct" type="number" min={1} max={100} className="peb-input w-24" value={percent} onChange={(e) => setPercent(Number(e.target.value))} /><span className="text-sm text-muted">% of ranked entries</span></div></Field>
            <Button variant="primary" icon={<Calculator className="h-4 w-4" />} loading={busy} disabled={!(percent >= 1 && percent <= 100)} onClick={() => void compute(false)}>{rows.length ? 'Recompute' : 'Compute results'}</Button>
          </div>
          {pending !== null && (
            <Alert tone="warning" className="mt-4" title={`${pending} evaluation(s) are still queued or failed`} action={<Button size="sm" variant="danger" onClick={() => void compute(true)}>Compute anyway</Button>}>
              Finish or retry them on the Round 1 page first. Computing now scores those answers as 0.
            </Alert>
          )}
        </Panel>
        <Panel title="Ranking" description={rows.length ? `${rows.length} entries · ${qualified} qualified · computed ${new Date(rows[0]!.computed_at).toLocaleString()}` : undefined}
          actions={<><ExportLink type="round1_results">Ranking CSV</ExportLink><ExportLink type="round1_answers">All answers CSV</ExportLink></>} bodyClassName="p-0">
          {!data ? <div className="p-5"><SkeletonRows /></div> : rows.length === 0 ? (
            <div className="p-5"><EmptyState icon={<Trophy className="h-6 w-6" />} title="No results yet">End Round 1, let AI evaluation finish, then compute results.</EmptyState></div>
          ) : (
            <div className="max-h-[36rem] overflow-auto">
              <table className="peb-table">
                <thead><tr><th>Rank</th><th>Entry</th><th>Team</th><th className="text-right">Score</th><th>Status</th></tr></thead>
                <tbody>{rows.map((r) => { const e = one(r.entry); return (
                  <tr key={`${e?.entry_number}`}>
                    <td className="tabular">{r.rank}{isTie(r.rank) && <Badge tone="amber" className="ml-2">tie</Badge>}</td>
                    <td className="font-display text-base font-semibold tabular">{e?.entry_number}</td>
                    <td>{names(e)}</td>
                    <td className="text-right tabular">{Number(r.score).toFixed(1)}</td>
                    <td>{r.qualified ? <Badge tone="violet">Qualified</Badge> : <span className="text-xs text-muted">—</span>}</td>
                  </tr>); })}</tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <Publication scope="round1" pub={pub} hasResults={rows.length > 0} onSaved={onPublished} />
    </div>
  );
}

function FinalResults({ pub, onPublished }: { pub: PubVM | null; onPublished: () => Promise<void> }) {
  const toast = useToast();
  const [rows, setRows] = useState<FinalRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [incomplete, setIncomplete] = useState<Record<string, unknown> | null>(null);
  const load = useCallback(async () => setRows((await api<{ results: FinalRow[] }>('/api/admin/results/final', { loginPath: LOGIN })).results), []);
  useEffect(() => { void load().catch((e) => toast.error(errorMessage(e))); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const compute = async (force = false) => {
    setBusy(true);
    try {
      const r = await api<{ entries: number }>('/api/admin/results/final', { method: 'POST', body: { force }, loginPath: LOGIN });
      toast.success(`Final ranking computed for ${r.entries} finalist(s). Publication was reset — review, then publish.`);
      setIncomplete(null);
      await Promise.all([load(), onPublished()]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'incomplete') setIncomplete(e.body ?? {});
      else toast.error(errorMessage(e));
    } finally { setBusy(false); }
  };
  const isTie = useMemo(() => tieRanks(rows ?? []), [rows]);
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-5">
        <Panel title="Compute final results" description="Round 2 = average jury marks + system (AI) score. Final = Round 1 × weight + Round 2 × weight (set in Round 2 → Settings). Ties are broken by the jury score, then the system score, then Round 1.">
          <Button variant="primary" icon={<Calculator className="h-4 w-4" />} loading={busy} onClick={() => void compute(false)}>{rows?.length ? 'Recompute' : 'Compute final results'}</Button>
          {incomplete && (
            <Alert tone="warning" className="mt-4" title="Some scores are not final yet" action={<Button size="sm" variant="danger" onClick={() => void compute(true)}>Compute anyway</Button>}>
              {Number(incomplete.pendingAi) > 0 && <>AI evaluations pending: {String(incomplete.pendingAi)}. </>}
              {Number(incomplete.teamsWithoutJuryScore) > 0 && <>Teams without a jury score: {String(incomplete.teamsWithoutJuryScore)}. </>}
              {Number(incomplete.unlockedJuryScores) > 0 && <>Jury scores not locked: {String(incomplete.unlockedJuryScores)}.</>}
            </Alert>
          )}
        </Panel>
        {rows && rows.length > 0 && (
          <Panel title="Winners" description={pub?.settings?.final?.published ? 'Published — students and the projector show this.' : 'Not published yet. Check the ranking, then publish to declare the winners.'}>
            <Podium winners={rows.filter((r) => r.rank <= WINNER_PLACES).map((r) => { const e = one(r.entry); return {
              rank: r.rank, entryNumber: e?.entry_number ?? null, teamName: e?.team_name ?? null,
              members: [...(e?.team_members ?? [])].sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name), score: Number(r.final_score) }; })} />
          </Panel>
        )}
        <Panel title="Final ranking" actions={<><ExportLink type="final_results">Final CSV</ExportLink><ExportLink type="jury_scores">Jury scores CSV</ExportLink><ExportLink type="round2_work">Round 2 work CSV</ExportLink></>} bodyClassName="p-0">
          {!rows ? <div className="p-5"><SkeletonRows /></div> : rows.length === 0 ? (
            <div className="p-5"><EmptyState icon={<Trophy className="h-6 w-6" />} title="No final results yet">End Round 2 and finish jury scoring, then compute.</EmptyState></div>
          ) : (
            <div className="overflow-x-auto"><table className="peb-table min-w-[640px]">
              <thead><tr><th>Rank</th><th>Entry</th><th>Team</th><th className="text-right">Round 1</th><th className="text-right">Jury</th><th className="text-right">System</th><th className="text-right">Round 2</th><th className="text-right">Final</th></tr></thead>
              <tbody>{rows.map((r) => { const e = one(r.entry); return (
                <tr key={r.entry_id}>
                  <td className="tabular">{r.rank}{isTie(r.rank) && <Badge tone="amber" className="ml-2">tie</Badge>}</td>
                  <td className="font-display text-base font-semibold tabular">{e?.entry_number}</td><td>{names(e)}</td>
                  <td className="text-right tabular">{Number(r.round1_score).toFixed(1)}</td><td className="text-right tabular">{r.round2_jury ?? '—'}</td><td className="text-right tabular">{r.round2_ai ?? '—'}</td>
                  <td className="text-right tabular">{Number(r.round2_score).toFixed(1)}</td><td className="text-right font-semibold tabular text-white">{Number(r.final_score).toFixed(1)}</td>
                </tr>); })}</tbody>
            </table></div>
          )}
        </Panel>
      </div>
      <Publication scope="final" pub={pub} hasResults={(rows?.length ?? 0) > 0} onSaved={onPublished} />
    </div>
  );
}
