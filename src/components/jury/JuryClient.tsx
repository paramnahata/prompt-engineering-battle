'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, MessageSquareText, Send, Unlock, Gavel } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Badge, RoundStatusBadge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';

const LOGIN = organizerLogin('/judge/dashboard');
type Criterion = { key: 'understanding' | 'response_quality' | 'adaptability' | 'interaction'; label: string; max: number };
interface TeamRow { entryId: string; entryNumber: number | null; teamName: string | null; members: string[]; state: string; problemTitle: string | null; myScore: { total: number; locked: boolean } | null; scoreCount: number; questions: number; unanswered: number }
interface Board { serverNow: string; round: { status: string; round_end_at: string | null } | null; jury: { enabled: boolean; criteria: Criterion[] } | null; role: string; teams: TeamRow[] }
interface Detail {
  entry: { entry_number: number; team_name: string | null; team_members: { member_position: number; full_name: string; college: string | null }[] };
  work: { state: string; initial_prompt: string | null; initial_output: string | null; final_prompt: string | null; final_output: string | null; rationale: string | null; twist_snapshot: { title?: string; description?: string } | null; twist_revealed_at: string | null; final_submitted_at: string | null; submission_ref: string | null; auto_submitted: boolean; last_saved_at: string | null };
  problem: { title?: string; problem_code?: string; problem_statement?: string; instructions?: string; constraints?: string; expected_output?: string; evaluation_criteria?: string } | null;
  questions: { id: string; question: string; answer: string | null; askedAt: string; answeredAt: string | null; askedBy: string }[];
  scores: ({ judge_id: string; judge: string | null; total: number; locked: boolean; mine: boolean; notes?: string | null } & Partial<Record<Criterion['key'], number>>)[];
  ai: { ai_subtotal: number; summary: string | null; problem_understanding: number; prompt_structure: number; context_specificity: number; creativity: number; constraint_handling: number; output_quality: number } | null;
  reviews: { old_score: number | null; new_score: number; reason: string; created_at: string }[];
}
const STAGE: Record<string, { label: string; tone: Tone }> = {
  R2_WAITING: { label: 'Waiting', tone: 'neutral' }, INITIAL_PROMPT: { label: 'First attempt', tone: 'blue' }, OUTPUT: { label: 'First attempt locked', tone: 'violet' },
  SURPRISE_REVEALED: { label: 'Twist revealed', tone: 'amber' }, REFINEMENT: { label: 'Refining', tone: 'blue' }, FINAL_SUBMISSION: { label: 'Submitted', tone: 'green' },
};

export default function JuryClient({ role }: { role: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setBoard(await api<Board>('/api/jury/teams', { loginPath: LOGIN })); setError(null); } catch (e) { setError(errorMessage(e)); throw e; }
  }, []);
  usePolling(load, 6000);
  const left = useServerCountdown({ endAtIso: board?.round?.status === 'running' ? board.round.round_end_at : null, serverNowIso: board?.serverNow ?? null });
  useEffect(() => { if (!selected && board?.teams.length) setSelected(board.teams[0]!.entryId); }, [board, selected]);

  return (
    <div>
      <PageHeader title="Jury" description={role === 'judge' ? 'Follow each finalist, ask questions and record your score. Lock it when you are sure.' : 'Every judge’s scores, questions and the AI evaluation for each finalist.'}
        meta={<><RoundStatusBadge status={board?.round?.status} />{left !== null && <span className="font-display text-lg font-semibold tabular text-white">{formatMMSS(left)}</span>}</>} />
      {error && <Alert tone="error" className="mb-5">{error}</Alert>}
      {board && board.round?.status === 'not_started' && <Alert tone="info" className="mb-5">Round 2 has not started. Finalists appear here once it begins.</Alert>}
      {!board ? <SkeletonRows rows={6} /> : board.teams.length === 0 ? (
        <EmptyState icon={<Gavel className="h-6 w-6" />} title="No finalists to judge yet">When Round 2 starts, every finalist appears here.</EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Finalists" className="peb-panel max-h-[75vh] overflow-y-auto p-2 lg:sticky lg:top-20">
            <ul className="space-y-1">
              {board.teams.map((t) => {
                const s = STAGE[t.state] ?? { label: t.state, tone: 'neutral' as Tone };
                return (
                  <li key={t.entryId}>
                    <button type="button" onClick={() => setSelected(t.entryId)} aria-current={selected === t.entryId}
                      className={cn('w-full rounded-lg px-3 py-2.5 text-left transition-colors', selected === t.entryId ? 'bg-violet-500/15' : 'hover:bg-white/[0.04]')}>
                      <div className="flex items-center gap-2">
                        <span className="font-display text-lg font-semibold tabular text-white">{t.entryNumber}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{t.teamName || t.members[0]}</span>
                        {t.myScore?.locked ? <Lock className="h-3.5 w-3.5 text-emerald-300" aria-label="Your score is locked" /> : t.myScore ? <span className="text-xs text-muted">{t.myScore.total}</span> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5"><Badge tone={s.tone}>{s.label}</Badge>{t.unanswered > 0 && <Badge tone="amber">{t.unanswered} open question{t.unanswered === 1 ? '' : 's'}</Badge>}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          {selected && <TeamDetail key={selected} entryId={selected} role={role} jury={board.jury} roundStatus={board.round?.status ?? 'not_started'} onChanged={load} />}
        </div>
      )}
    </div>
  );
}

function TextBlock({ label, text, empty = 'Nothing yet.' }: { label: string; text: string | null | undefined; empty?: string }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      <div className="peb-inset max-h-72 overflow-y-auto whitespace-pre-wrap px-3.5 py-3 text-sm leading-6 text-slate-200">{text?.trim() ? text : <span className="text-faint">{empty}</span>}</div>
    </div>
  );
}

function TeamDetail({ entryId, role, jury, roundStatus, onChanged }: { entryId: string; role: string; jury: Board['jury']; roundStatus: string; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const load = useCallback(async () => setD(await api<Detail>(`/api/jury/teams/${entryId}`, { loginPath: LOGIN })), [entryId]);
  usePolling(load, 7000);
  if (!d) return <div className="peb-panel p-5"><SkeletonRows rows={8} /></div>;

  const ask = async () => {
    setAsking(true);
    try {
      await api('/api/jury/questions', { method: 'POST', body: { entryId, question }, loginPath: LOGIN });
      setQuestion('');
      toast.success('Question sent to the team.');
      await Promise.all([load(), onChanged()]);
    } catch (e) { toast.error(errorMessage(e)); } finally { setAsking(false); }
  };
  const p = d.problem;
  const w = d.work;
  const canAsk = roundStatus === 'running' || roundStatus === 'paused';
  return (
    <div className="space-y-5">
      <section className="peb-panel p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-display text-3xl font-semibold tabular text-white">#{d.entry.entry_number}</h2>
          <span className="text-lg text-slate-200">{d.entry.team_name || 'Individual entry'}</span>
          {STAGE[w.state] && <Badge tone={STAGE[w.state]!.tone}>{STAGE[w.state]!.label}</Badge>}
          {w.submission_ref && <Badge tone="green">Ref {w.submission_ref}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">{d.entry.team_members.sort((a, b) => a.member_position - b.member_position).map((m) => `${m.full_name}${m.college ? ` (${m.college})` : ''}`).join(' · ')}</p>
      </section>

      <Panel title={p?.title ?? 'Problem'} description={p?.problem_code ? `Problem ${p.problem_code}` : undefined}>
        <div className="space-y-4">
          <TextBlock label="Problem statement" text={p?.problem_statement} />
          {(p?.instructions || p?.constraints) && <div className="grid gap-4 md:grid-cols-2"><TextBlock label="Instructions" text={p?.instructions} /><TextBlock label="Constraints" text={p?.constraints} /></div>}
          {(p?.expected_output || p?.evaluation_criteria) && (
            <div className="grid gap-4 md:grid-cols-2"><TextBlock label="Expected output (jury only)" text={p?.expected_output} /><TextBlock label="Evaluation criteria (jury only)" text={p?.evaluation_criteria} /></div>
          )}
          {w.twist_snapshot && <Alert tone="warning" title={`Twist: ${w.twist_snapshot.title}`}>{w.twist_snapshot.description}</Alert>}
        </div>
      </Panel>

      <Panel title="The team’s work" description={w.last_saved_at ? `Last saved ${new Date(w.last_saved_at).toLocaleTimeString()}${w.auto_submitted ? ' · submitted automatically at the deadline' : ''}` : undefined}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextBlock label="First attempt — prompt" text={w.initial_prompt} />
          <TextBlock label="First attempt — AI output" text={w.initial_output} />
          <TextBlock label="Final prompt" text={w.final_prompt} />
          <TextBlock label="Final AI output" text={w.final_output} />
        </div>
        <div className="mt-4"><TextBlock label="Their explanation" text={w.rationale} /></div>
      </Panel>

      <Panel title="Questions" description="Questions appear on the team’s screen; their answers show up here.">
        {d.questions.length === 0 ? <p className="text-sm text-muted">No questions asked yet.</p> : (
          <ol className="space-y-3">
            {d.questions.map((q) => (
              <li key={q.id} className="peb-inset p-3.5">
                <div className="flex items-start gap-2 text-sm"><MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" /><div className="flex-1"><span className="text-slate-100">{q.question}</span><div className="text-xs text-faint">{q.askedBy} · {new Date(q.askedAt).toLocaleTimeString()}</div></div></div>
                <div className="mt-2 border-l-2 border-cyan-400/40 pl-3 text-sm">{q.answer ? <span className="whitespace-pre-wrap text-slate-200">{q.answer}</span> : <span className="text-amber-200/80">Waiting for the team’s answer…</span>}</div>
              </li>
            ))}
          </ol>
        )}
        {canAsk && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="ask" className="sr-only">Ask the team a question</label>
            <input id="ask" className="peb-input" placeholder="Ask the team a question…" value={question} maxLength={2000} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && question.trim().length >= 3 && void ask()} />
            <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={asking} disabled={question.trim().length < 3} onClick={() => void ask()}>Send</Button>
          </div>
        )}
      </Panel>

      {role === 'judge' && jury?.enabled && <ScoreForm entryId={entryId} criteria={jury.criteria} mine={d.scores.find((s) => s.mine) ?? null} disabled={roundStatus === 'not_started'} onSaved={async () => { await Promise.all([load(), onChanged()]); }} />}
      {role === 'admin' && <AdminReview d={d} entryId={entryId} criteria={jury?.criteria ?? []} onChanged={async () => { await Promise.all([load(), onChanged()]); }} />}
    </div>
  );
}

function ScoreForm({ entryId, criteria, mine, disabled, onSaved }: { entryId: string; criteria: Criterion[]; mine: Detail['scores'][number] | null; disabled: boolean; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const active = criteria.filter((c) => c.max > 0);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(active.map((c) => [c.key, mine?.[c.key] !== undefined ? String(mine[c.key]) : ''])));
  const [notes, setNotes] = useState(mine?.notes ?? '');
  const [busy, setBusy] = useState<null | 'save' | 'lock'>(null);
  const locked = Boolean(mine?.locked);
  const total = active.reduce((a, c) => a + (Number(vals[c.key]) || 0), 0);
  const max = active.reduce((a, c) => a + c.max, 0);
  const invalid = active.some((c) => vals[c.key] !== '' && (Number(vals[c.key]) < 0 || Number(vals[c.key]) > c.max || Number.isNaN(Number(vals[c.key]))));
  const save = async (lock: boolean) => {
    if (lock && !window.confirm('Lock your score? You will not be able to change it unless an admin unlocks it.')) return;
    setBusy(lock ? 'lock' : 'save');
    try {
      const scores = Object.fromEntries(active.map((c) => [c.key, Number(vals[c.key]) || 0]));
      await api('/api/jury/scores', { method: 'PUT', body: { entryId, scores, notes, lock }, loginPath: LOGIN });
      toast.success(lock ? 'Score locked.' : 'Score saved.');
      await onSaved();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <Panel title="Your score" description={locked ? 'Locked. Ask an admin if it needs to change.' : 'Saved scores can be changed until you lock them.'}
      actions={<span className="font-display text-2xl font-semibold tabular text-white">{total}<span className="text-base text-muted"> / {max}</span></span>}>
      <fieldset disabled={locked || disabled} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {active.map((c) => (
            <Field key={c.key} id={`score-${c.key}`} label={`${c.label} (0–${c.max})`}>
              <input id={`score-${c.key}`} type="number" inputMode="decimal" min={0} max={c.max} step={0.5} className="peb-input" value={vals[c.key] ?? ''}
                onChange={(e) => setVals((v) => ({ ...v, [c.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <Field id="score-notes" label="Notes (only organizers see these)"><textarea id="score-notes" rows={3} className="peb-input" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} /></Field>
        {invalid && <Alert tone="error">Each score must be between 0 and its maximum.</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button loading={busy === 'save'} disabled={invalid} onClick={() => void save(false)}>Save score</Button>
          <Button variant="primary" icon={<Lock className="h-4 w-4" />} loading={busy === 'lock'} disabled={invalid} onClick={() => void save(true)}>Save and lock</Button>
        </div>
      </fieldset>
    </Panel>
  );
}

function AdminReview({ d, entryId, criteria, onChanged }: { d: Detail; entryId: string; criteria: Criterion[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [score, setScore] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const override = async () => {
    setBusy(true);
    try {
      await api('/api/admin/round2/review', { method: 'POST', body: { action: 'override', entryId, newScore: Number(score), reason }, loginPath: LOGIN });
      toast.success('Override recorded. Recompute final results to apply it.');
      setScore(''); setReason('');
      await onChanged();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const unlock = async (judgeId: string) => {
    try { await api('/api/admin/round2/review', { method: 'POST', body: { action: 'unlock_jury', entryId, judgeId }, loginPath: LOGIN }); toast.success('Score unlocked.'); await onChanged(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const avg = d.scores.length ? Math.round((d.scores.reduce((a, s) => a + Number(s.total), 0) / d.scores.length) * 10) / 10 : null;
  return (
    <>
      <Panel title="Jury scores" description={avg !== null ? `Average ${avg} across ${d.scores.length} judge(s)` : 'No judge has scored this team yet.'} bodyClassName="p-0">
        {d.scores.length > 0 && (
          <div className="overflow-x-auto"><table className="peb-table">
            <thead><tr><th>Judge</th>{criteria.filter((c) => c.max > 0).map((c) => <th key={c.key}>{c.label}</th>)}<th>Total</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{d.scores.map((s) => (
              <tr key={s.judge_id}><td>{s.judge}</td>{criteria.filter((c) => c.max > 0).map((c) => <td key={c.key} className="tabular">{s[c.key] ?? '—'}</td>)}<td className="font-semibold tabular">{s.total}</td>
                <td>{s.locked ? <Badge tone="green">Locked</Badge> : <Badge tone="amber">Draft</Badge>}</td>
                <td>{s.locked && <Button size="sm" variant="ghost" icon={<Unlock className="h-3.5 w-3.5" />} onClick={() => void unlock(s.judge_id)}>Unlock</Button>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {d.ai && (
        <Panel title="AI evaluation" description={`${d.ai.ai_subtotal} / 60 before scaling`}>
          <p className="text-sm text-slate-200">{d.ai.summary}</p>
        </Panel>
      )}
      <Panel title="Override Round 2 score" description="Replaces the jury + AI total for this team when final results are computed. Recorded with your name and reason.">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
          <Field id="ov-score" label="New score"><input id="ov-score" type="number" min={0} className="peb-input" value={score} onChange={(e) => setScore(e.target.value)} /></Field>
          <Field id="ov-reason" label="Reason"><input id="ov-reason" className="peb-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button loading={busy} disabled={score === '' || Number(score) < 0 || reason.trim().length < 3} onClick={() => void override()}>Save override</Button>
        </div>
        {d.reviews.length > 0 && <ul className="mt-4 space-y-1 text-xs text-muted">{d.reviews.map((r) => <li key={r.created_at}>{new Date(r.created_at).toLocaleString()}: {r.old_score ?? '—'} → <span className="text-slate-200">{r.new_score}</span> — {r.reason}</li>)}</ul>}
      </Panel>
    </>
  );
}
