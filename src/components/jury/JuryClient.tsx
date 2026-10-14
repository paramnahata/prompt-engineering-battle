'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, MessageSquareText, Send, Unlock, Gavel, Sparkles, Plus, Wand2, ChevronDown } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Badge, RoundStatusBadge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Tabs, TabsContent, TabsList } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';

const LOGIN = organizerLogin('/judge/dashboard');
type Criterion = { key: 'understanding' | 'response_quality' | 'adaptability' | 'interaction'; label: string; max: number };
interface JuryConfig { enabled: boolean; mode?: 'criteria' | 'questions'; questionCount?: number; questionMax?: number; criteria: Criterion[] }
interface TeamRow { entryId: string; entryNumber: number | null; teamName: string | null; members: string[]; state: string; problemTitle: string | null; myScore: { total: number; locked: boolean } | null; scoreCount: number; questions: number; unanswered: number }
interface Board { serverNow: string; round: { status: string; round_end_at: string | null } | null; jury: JuryConfig | null; role: string; teams: TeamRow[] }
type QuestionMark = { question: string; mark: number; source: 'own' | 'suggested' };
interface Score { judge_id: string; judge: string | null; total: number; max_total?: number | null; locked: boolean; mine: boolean; notes?: string | null; question_scores?: QuestionMark[] | null; understanding?: number; response_quality?: number; adaptability?: number; interaction?: number }
interface Detail {
  entry: { entry_number: number; team_name: string | null; team_members: { member_position: number; full_name: string; college: string | null }[] };
  work: { state: string; initial_prompt: string | null; initial_output: string | null; final_prompt: string | null; final_output: string | null; rationale: string | null; twist_snapshot: { title?: string; description?: string } | null; twist_revealed_at: string | null; final_submitted_at: string | null; submission_ref: string | null; auto_submitted: boolean; last_saved_at: string | null };
  problem: { title?: string; problem_code?: string; category?: string; difficulty?: string; problem_statement?: string; instructions?: string; constraints?: string; twist_title?: string; twist_description?: string; sample_prompt?: string; expected_output?: string; evaluation_criteria?: string } | null;
  suggestions: { id: string; focus: string; text: string }[];
  questions: { id: string; question: string; answer: string | null; askedAt: string; answeredAt: string | null; askedBy: string }[];
  scores: Score[];
  ai: { ai_subtotal: number; summary: string | null } | null;
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
  const questionMode = board?.jury?.mode === 'questions';

  return (
    <div>
      <PageHeader title="Jury"
        description={role === 'judge'
          ? (questionMode ? 'Pick a team, read their problem, prompt and output, ask your questions in person and mark each answer.' : 'Follow each finalist, ask questions and record your score. Lock it when you are sure.')
          : 'Every judge’s marks, questions and the system evaluation for each finalist.'}
        meta={<><RoundStatusBadge status={board?.round?.status} />{left !== null && <span className="font-display text-lg font-semibold tabular text-white">{formatMMSS(left)}</span>}</>} />
      {error && <Alert tone="error" className="mb-5">{error}</Alert>}
      {board && board.round?.status === 'not_started' && <Alert tone="info" className="mb-5">Round 2 has not started. Finalists appear here once it begins.</Alert>}
      {!board ? <SkeletonRows rows={6} /> : board.teams.length === 0 ? (
        <EmptyState icon={<Gavel className="h-6 w-6" />} title="No finalists to judge yet">When Round 2 starts, every finalist appears here.</EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          {/* Phones: a compact picker that stays at the top. */}
          <div className="sticky top-14 z-20 -mx-4 border-b border-line bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
            <label htmlFor="team-pick" className="sr-only">Team</label>
            <select id="team-pick" className="peb-input" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {board.teams.map((t) => (
                <option key={t.entryId} value={t.entryId}>
                  #{t.entryNumber} {t.teamName || t.members[0] || ''} — {(STAGE[t.state]?.label ?? t.state)}{t.myScore ? (t.myScore.locked ? ' · locked' : ` · ${t.myScore.total}`) : ''}
                </option>
              ))}
            </select>
          </div>
          <nav aria-label="Finalists" className="peb-panel hidden max-h-[75vh] overflow-y-auto p-2 lg:sticky lg:top-20 lg:block">
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
                      {t.problemTitle && <div className="mt-0.5 truncate text-xs text-muted">{t.problemTitle}</div>}
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

function TextBlock({ label, text, empty = 'Nothing yet.', tall = false }: { label: string; text: string | null | undefined; empty?: string; tall?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      <div className={cn('peb-inset overflow-y-auto whitespace-pre-wrap break-words px-3.5 py-3 text-sm leading-6 text-slate-200', tall ? 'max-h-[28rem]' : 'max-h-72')}>{text?.trim() ? text : <span className="text-faint">{empty}</span>}</div>
    </div>
  );
}

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-medium text-slate-200">
        {title}<ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && <div className="space-y-4 border-t border-line p-3.5">{children}</div>}
    </div>
  );
}

function TeamDetail({ entryId, role, jury, roundStatus, onChanged }: { entryId: string; role: string; jury: JuryConfig | null; roundStatus: string; onChanged: () => Promise<void> }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState('work');
  const load = useCallback(async () => setD(await api<Detail>(`/api/jury/teams/${entryId}`, { loginPath: LOGIN })), [entryId]);
  usePolling(load, 7000);
  if (!d) return <div className="peb-panel p-5"><SkeletonRows rows={8} /></div>;

  const p = d.problem;
  const w = d.work;
  const mine = d.scores.find((s) => s.mine) ?? null;
  const questionMode = jury?.mode === 'questions';
  const refresh = async () => { await Promise.all([load(), onChanged()]); };
  return (
    <div className="min-w-0 space-y-4">
      <section className="peb-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-3xl font-semibold tabular text-white">#{d.entry.entry_number}</h2>
          <span className="text-lg text-slate-200">{d.entry.team_name || 'Individual entry'}</span>
          {STAGE[w.state] && <Badge tone={STAGE[w.state]!.tone}>{STAGE[w.state]!.label}</Badge>}
          {mine && <Badge tone={mine.locked ? 'green' : 'amber'}>{mine.locked ? `Your marks: ${mine.total} (locked)` : `Your draft: ${mine.total}`}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">{[...d.entry.team_members].sort((a, b) => a.member_position - b.member_position).map((m) => `${m.full_name}${m.college ? ` (${m.college})` : ''}`).join(' · ')}</p>
        {p && <p className="mt-2 text-sm text-slate-300"><span className="text-muted">{p.problem_code ? `${p.problem_code} · ` : ''}</span>{p.title}{p.category ? <span className="text-muted"> · {p.category}</span> : null}</p>}
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4" items={[
          { value: 'work', label: 'Problem & work' },
          ...(role === 'judge' && jury?.enabled ? [{ value: 'mark', label: questionMode ? 'Ask & mark' : 'Score' }] : []),
          { value: 'reference', label: 'Jury reference' },
          { value: 'written', label: 'Written Q&A', count: d.questions.length || undefined },
          ...(role === 'admin' ? [{ value: 'scores', label: 'All marks', count: d.scores.length || undefined }] : []),
        ]} />

        <TabsContent value="work" className="space-y-4">
          <Panel title={p?.title ?? 'Problem'} description="What the team sees">
            <div className="space-y-4">
              <TextBlock label="Problem statement" text={p?.problem_statement} />
              {(p?.instructions || p?.constraints) && <div className="grid gap-4 md:grid-cols-2"><TextBlock label="Instructions" text={p?.instructions} /><TextBlock label="Constraints" text={p?.constraints} /></div>}
              {w.twist_snapshot && w.twist_revealed_at
                ? <Alert tone="warning" title={`Twist: ${w.twist_snapshot.title}`}>{w.twist_snapshot.description}</Alert>
                : p?.twist_description ? <p className="text-xs text-muted">The twist has not been revealed to this team yet (see Jury reference).</p> : null}
            </div>
          </Panel>
          <Panel title="Their prompt and AI output" description={w.last_saved_at ? `Last saved ${new Date(w.last_saved_at).toLocaleTimeString()}${w.auto_submitted ? ' · submitted automatically at the deadline' : ''}` : undefined}>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <TextBlock label={w.twist_revealed_at ? 'Final prompt' : 'Prompt'} text={w.final_prompt || w.initial_prompt} tall />
                <TextBlock label={w.twist_revealed_at ? 'Final AI output' : 'AI output'} text={w.final_output || w.initial_output} tall />
              </div>
              <TextBlock label="Their explanation" text={w.rationale} />
              {w.twist_revealed_at && (w.initial_prompt || w.initial_output) && (
                <Collapsible title="First attempt (before the twist)">
                  <TextBlock label="First prompt" text={w.initial_prompt} />
                  <TextBlock label="First AI output" text={w.initial_output} />
                </Collapsible>
              )}
            </div>
          </Panel>
          {role === 'judge' && jury?.enabled && <Button variant="primary" className="w-full sm:w-auto" onClick={() => setTab('mark')}>{questionMode ? 'Ask questions & mark' : 'Score this team'}</Button>}
        </TabsContent>

        {role === 'judge' && jury?.enabled && (
          <TabsContent value="mark">
            {questionMode
              ? <QuestionScoreForm entryId={entryId} count={jury.questionCount ?? 5} max={jury.questionMax ?? 10} mine={mine} suggestions={d.suggestions} disabled={roundStatus === 'not_started'} onSaved={refresh} />
              : <ScoreForm entryId={entryId} criteria={jury.criteria} mine={mine} disabled={roundStatus === 'not_started'} onSaved={refresh} />}
          </TabsContent>
        )}

        <TabsContent value="reference">
          <Panel title="Jury reference" description="Never shown to students. Accept other approaches when assumptions are explicit and the maths is right.">
            <div className="space-y-4">
              {p?.twist_description && <TextBlock label={`Twist for this problem${w.twist_revealed_at ? ' (revealed)' : ' (not revealed yet — do not mention it)'}`} text={p.twist_description} />}
              <TextBlock label="Sample expected prompt" text={p?.sample_prompt} empty="No sample prompt for this problem." />
              <TextBlock label="Expected solution" text={p?.expected_output} empty="No expected solution for this problem." />
              <TextBlock label="Evaluation criteria" text={p?.evaluation_criteria} empty="No criteria." tall />
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="written">
          <WrittenQuestions d={d} entryId={entryId} canAsk={roundStatus === 'running' || roundStatus === 'paused'} onChanged={refresh} />
        </TabsContent>

        {role === 'admin' && (
          <TabsContent value="scores">
            <AdminReview d={d} entryId={entryId} jury={jury} onChanged={refresh} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function WrittenQuestions({ d, entryId, canAsk, onChanged }: { d: Detail; entryId: string; canAsk: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    setAsking(true);
    try {
      await api('/api/jury/questions', { method: 'POST', body: { entryId, question }, loginPath: LOGIN });
      setQuestion('');
      toast.success('Question sent to the team’s screen.');
      await onChanged();
    } catch (e) { toast.error(errorMessage(e)); } finally { setAsking(false); }
  };
  return (
    <Panel title="Written questions" description="Optional: send a question to the team’s screen; their typed answer shows up here. For in-person questions use “Ask & mark”.">
      {d.questions.length === 0 ? <p className="text-sm text-muted">No written questions yet.</p> : (
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
          <input id="ask" className="peb-input" placeholder="Type a question for the team’s screen…" value={question} maxLength={2000} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && question.trim().length >= 3 && void ask()} />
          <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={asking} disabled={question.trim().length < 3} onClick={() => void ask()}>Send</Button>
        </div>
      )}
    </Panel>
  );
}

type Row = { question: string; mark: string; source: 'own' | 'suggested' };

function QuestionScoreForm({ entryId, count, max, mine, suggestions, disabled, onSaved }: { entryId: string; count: number; max: number; mine: Score | null; suggestions: Detail['suggestions']; disabled: boolean; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: count }, (_, i) => {
    const q = mine?.question_scores?.[i];
    return q ? { question: q.question, mark: String(q.mark), source: q.source } : { question: '', mark: '', source: 'own' };
  }));
  const [notes, setNotes] = useState(mine?.notes ?? '');
  const [busy, setBusy] = useState<null | 'save' | 'lock' | 'ai'>(null);
  const [aiQs, setAiQs] = useState<string[]>([]);
  const locked = Boolean(mine?.locked);
  const used = useMemo(() => new Set(rows.map((r) => r.question.trim())), [rows]);
  const total = rows.reduce((a, r) => a + (r.mark !== '' && Number.isFinite(Number(r.mark)) ? Number(r.mark) : 0), 0);
  const filled = rows.filter((r) => r.question.trim() && r.mark !== '').length;
  const problems = rows.flatMap((r, i) => {
    const hasQ = Boolean(r.question.trim());
    const hasM = r.mark !== '';
    if (hasM && (!Number.isFinite(Number(r.mark)) || Number(r.mark) < 0 || Number(r.mark) > max)) return [`Question ${i + 1}: the mark must be 0–${max}.`];
    if (hasQ !== hasM) return [hasQ ? `Question ${i + 1}: give a mark.` : `Question ${i + 1}: write the question you asked.`];
    return [];
  });
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const applySuggestion = (text: string) => {
    const i = rows.findIndex((r) => !r.question.trim());
    if (i < 0) { toast.error(`All ${count} questions already have text. Clear one first.`); return; }
    setRow(i, { question: text, source: 'suggested' });
    document.getElementById(`q-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const askAi = async () => {
    setBusy('ai');
    try {
      const r = await api<{ questions: string[] }>(`/api/jury/teams/${entryId}/suggest`, { method: 'POST', body: {}, loginPath: LOGIN });
      setAiQs(r.questions);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const save = async (lock: boolean) => {
    if (lock && filled < count) { toast.error(`Mark all ${count} questions before locking.`); return; }
    if (lock && !window.confirm(`Lock ${total} / ${count * max} for this team? You cannot change it unless an admin unlocks it.`)) return;
    setBusy(lock ? 'lock' : 'save');
    try {
      const questions = rows.filter((r) => r.question.trim() && r.mark !== '').map((r) => ({ question: r.question.trim(), mark: Number(r.mark), source: r.source }));
      await api('/api/jury/scores', { method: 'PUT', body: { entryId, scores: { questions }, notes, lock }, loginPath: LOGIN });
      toast.success(lock ? 'Marks locked.' : 'Marks saved.');
      await onSaved();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const quick = max <= 10 && Number.isInteger(max);

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      {!locked && (
        <Panel title="Suggested questions" description="Built from this team’s problem, twist, prompt and output. Tap one to use it, or write your own below."
          actions={<Button size="sm" variant="ghost" icon={<Wand2 className="h-3.5 w-3.5" />} loading={busy === 'ai'} onClick={() => void askAi()}>AI suggestions</Button>}>
          <ul className="space-y-2">
            {[...aiQs.map((t, i) => ({ id: `ai-${i}`, focus: 'AI suggestion', text: t })), ...suggestions].map((s) => {
              const isUsed = used.has(s.text);
              return (
                <li key={s.id}>
                  <button type="button" disabled={isUsed || disabled} onClick={() => applySuggestion(s.text)}
                    className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                      isUsed ? 'border-emerald-400/30 bg-emerald-500/[0.06] text-slate-400' : 'border-line text-slate-200 hover:border-violet-400/50 hover:bg-violet-500/[0.06]')}>
                    {s.focus === 'AI suggestion' ? <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" /> : <Plus className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />}
                    <span className="flex-1"><span className="block text-[11px] font-medium uppercase tracking-wide text-muted">{s.focus}{isUsed ? ' · used' : ''}</span>{s.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel title="Your marks" description={locked ? 'Locked. Ask an admin if it needs to change.' : `Ask ${count} questions; mark each answer out of ${max}. Saved marks can be changed until you lock them.`}
        actions={<span className="font-display text-2xl font-semibold tabular text-white">{total}<span className="text-base text-muted"> / {count * max}</span></span>}>
        <fieldset disabled={locked || disabled} className="space-y-4">
          <ol className="space-y-4">
            {rows.map((r, i) => (
              <li key={i} id={`q-${i}`} className="peb-inset space-y-3 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Question {i + 1}{r.source === 'suggested' && r.question ? ' · suggested' : ''}</span>
                  {(r.question || r.mark) && !locked && <button type="button" className="text-xs text-muted hover:text-slate-200" onClick={() => setRow(i, { question: '', mark: '', source: 'own' })}>Clear</button>}
                </div>
                <label htmlFor={`q-text-${i}`} className="sr-only">Question {i + 1}</label>
                <textarea id={`q-text-${i}`} rows={3} className="peb-input" placeholder="The question you asked…" maxLength={500} value={r.question}
                  onChange={(e) => setRow(i, { question: e.target.value, source: r.source === 'suggested' && e.target.value ? 'suggested' : 'own' })} />
                {quick ? (
                  <div role="radiogroup" aria-label={`Mark for question ${i + 1}`} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
                    {Array.from({ length: max + 1 }, (_, m) => (
                      <button key={m} type="button" role="radio" aria-checked={r.mark === String(m)} onClick={() => setRow(i, { mark: r.mark === String(m) ? '' : String(m) })}
                        className={cn('h-10 rounded-md border text-sm font-semibold tabular transition-colors',
                          r.mark === String(m) ? 'border-violet-400 bg-violet-500 text-white' : 'border-line text-slate-300 hover:border-slate-500')}>{m}</button>
                    ))}
                  </div>
                ) : (
                  <Field id={`q-mark-${i}`} label={`Mark (0–${max})`}>
                    <input id={`q-mark-${i}`} type="number" inputMode="decimal" min={0} max={max} step={0.5} className="peb-input w-28" value={r.mark} onChange={(e) => setRow(i, { mark: e.target.value })} />
                  </Field>
                )}
              </li>
            ))}
          </ol>
          <Field id="score-notes" label="Notes (only organizers see these)"><textarea id="score-notes" rows={2} className="peb-input" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} /></Field>
          {problems.length > 0 && <Alert tone="error"><ul className="space-y-0.5">{problems.map((x) => <li key={x}>{x}</li>)}</ul></Alert>}
        </fieldset>
      </Panel>

      {!locked && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-background/95 px-4 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <div className="mr-auto text-sm text-muted lg:hidden"><span className="font-display text-xl font-semibold tabular text-white">{total}</span> / {count * max} · {filled}/{count}</div>
            <Button loading={busy === 'save'} disabled={disabled || problems.length > 0 || filled === 0} onClick={() => void save(false)}>Save</Button>
            <Button variant="primary" icon={<Lock className="h-4 w-4" />} loading={busy === 'lock'} disabled={disabled || problems.length > 0 || filled < count} onClick={() => void save(true)}>Save and lock</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreForm({ entryId, criteria, mine, disabled, onSaved }: { entryId: string; criteria: Criterion[]; mine: Score | null; disabled: boolean; onSaved: () => Promise<void> }) {
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

function AdminReview({ d, entryId, jury, onChanged }: { d: Detail; entryId: string; jury: JuryConfig | null; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [score, setScore] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const criteria = (jury?.criteria ?? []).filter((c) => c.max > 0);
  const questionMode = jury?.mode === 'questions';
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
    try { await api('/api/admin/round2/review', { method: 'POST', body: { action: 'unlock_jury', entryId, judgeId }, loginPath: LOGIN }); toast.success('Marks unlocked.'); await onChanged(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const avg = d.scores.length ? Math.round((d.scores.reduce((a, s) => a + Number(s.total), 0) / d.scores.length) * 10) / 10 : null;
  return (
    <div className="space-y-4">
      <Panel title="Jury marks" description={avg !== null ? `Average ${avg} across ${d.scores.length} judge(s)` : 'No judge has marked this team yet.'}>
        {d.scores.length > 0 && (
          <ul className="space-y-3">
            {d.scores.map((s) => (
              <li key={s.judge_id} className="peb-inset p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{s.judge}</span>
                  <span className="font-display text-lg font-semibold tabular text-white">{s.total}{s.max_total ? <span className="text-sm text-muted"> / {s.max_total}</span> : null}</span>
                  {s.locked ? <Badge tone="green">Locked</Badge> : <Badge tone="amber">Draft</Badge>}
                  {s.locked && <Button size="sm" variant="ghost" icon={<Unlock className="h-3.5 w-3.5" />} onClick={() => void unlock(s.judge_id)}>Unlock</Button>}
                </div>
                {s.question_scores?.length ? (
                  <ol className="mt-2 space-y-1 text-sm">{s.question_scores.map((q, i) => <li key={i} className="flex gap-2"><span className="w-10 shrink-0 font-semibold tabular text-slate-100">{q.mark}</span><span className="text-slate-300">{q.question}{q.source === 'suggested' && <span className="text-xs text-muted"> (suggested)</span>}</span></li>)}</ol>
                ) : !questionMode && criteria.length ? (
                  <p className="mt-1 text-xs text-muted">{criteria.map((c) => `${c.label}: ${s[c.key] ?? '—'}`).join(' · ')}</p>
                ) : null}
                {s.notes && <p className="mt-2 text-xs text-muted">Notes: {s.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {d.ai && (
        <Panel title="System (AI) evaluation" description={`${d.ai.ai_subtotal} / 60 before scaling`}>
          <p className="text-sm text-slate-200">{d.ai.summary}</p>
        </Panel>
      )}
      <Panel title="Override Round 2 score" description="Replaces the jury + system total for this team when final results are computed. Recorded with your name and reason.">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
          <Field id="ov-score" label="New score"><input id="ov-score" type="number" min={0} className="peb-input" value={score} onChange={(e) => setScore(e.target.value)} /></Field>
          <Field id="ov-reason" label="Reason"><input id="ov-reason" className="peb-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button loading={busy} disabled={score === '' || Number(score) < 0 || reason.trim().length < 3} onClick={() => void override()}>Save override</Button>
        </div>
        {d.reviews.length > 0 && <ul className="mt-4 space-y-1 text-xs text-muted">{d.reviews.map((r) => <li key={r.created_at}>{new Date(r.created_at).toLocaleString()}: {r.old_score ?? '—'} → <span className="text-slate-200">{r.new_score}</span> — {r.reason}</li>)}</ul>}
      </Panel>
    </div>
  );
}
