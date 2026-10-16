'use client';

import { isPasteLikeChange, logPasteBlocked } from '@/lib/client/no-paste';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock, Lock, MessageSquareText, Pause, Sparkles, Trophy } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { api, ApiError, errorMessage } from '@/lib/client/api';
import { Alert } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { cn } from '@/components/ui/cn';
import StudentShell, { StudentCenter } from './StudentShell';

interface R2State {
  serverNow: string; eligible: boolean; roundStatus: string; roundEndAt?: string | null; pausedAt?: string | null; state?: string;
  twistEnabled?: boolean; limits?: { promptWords: number; outputChars: number; rationaleWords: number };
  problem?: { title: string; statement: string; instructions: string | null; constraints: string | null } | null;
  twist?: { title: string; description: string; revealedAt: string } | null;
  initialPrompt?: string | null; initialOutput?: string | null; finalPrompt?: string | null; finalOutput?: string | null; rationale?: string | null;
  initialSubmittedAt?: string | null; finalSubmittedAt?: string | null; submissionRef?: string | null;
  questions?: { id: string; question: string; answer: string | null; askedAt: string; answeredAt: string | null }[];
}
type Stage = 'initial' | 'final';
type Fields = { prompt: string; output: string; rationale: string };
type SaveState = 'saved' | 'unsaved' | 'saving' | 'retrying' | 'error';

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const backupKey = (stage: Stage) => `peb:r2:${stage}`;
function readBackup(stage: Stage): Fields | null {
  try { const v = JSON.parse(window.localStorage.getItem(backupKey(stage)) ?? 'null'); return v && typeof v.prompt === 'string' ? v : null; } catch { return null; }
}
function writeBackup(stage: Stage, f: Fields) { try { window.localStorage.setItem(backupKey(stage), JSON.stringify(f)); } catch { /* storage unavailable */ } }
function clearBackup(stage: Stage) { try { window.localStorage.removeItem(backupKey(stage)); } catch { /* ignore */ } }

export default function Round2Arena({ entryNumber }: { entryNumber: number | null }) {
  const [s, setS] = useState<R2State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const goLogin = useCallback(() => window.location.replace('/student/login'), []);
  useHeartbeat(goLogin);
  const load = useCallback(async () => {
    try { setS(await api<R2State>('/api/student/round2/state', { loginPath: '/student/login' })); setError(null); }
    catch (e) { if (!(e instanceof ApiError && e.status === 401)) setError(errorMessage(e)); throw e; }
  }, []);
  usePolling(load, 5000);
  const left = useServerCountdown({ endAtIso: s?.roundStatus === 'running' ? s.roundEndAt ?? null : null, serverNowIso: s?.serverNow ?? null });

  if (!s) return <StudentCenter entryNumber={entryNumber} icon={<Clock className="h-6 w-6" />} title="Loading Round 2…">{error ?? 'Getting your problem and saved work.'}</StudentCenter>;
  if (!s.eligible) return <StudentCenter entryNumber={entryNumber} icon={<Trophy className="h-6 w-6" />} title="Round 2 is for finalists" action={<Link href="/student/waiting" className="peb-btn-secondary w-full">Back to my dashboard</Link>}>Your team is not in the final. Thank you for competing — check your dashboard for results.</StudentCenter>;
  if (s.roundStatus === 'not_started') return <StudentCenter entryNumber={entryNumber} icon={<Trophy className="h-6 w-6" />} title="You’re a finalist" action={<Link href="/student/waiting" className="peb-btn-secondary w-full">Back to my dashboard</Link>}>Round 2 hasn’t started yet. Your problem appears here the moment the organizers start the final.</StudentCenter>;
  if (s.roundStatus === 'paused') return <StudentCenter entryNumber={entryNumber} icon={<Pause className="h-6 w-6" />} title="Round 2 is paused">The timer is frozen and your work is saved. This page continues on its own.</StudentCenter>;

  const lowTime = left !== null && left <= 60;
  const stage: Stage | null = s.state === 'INITIAL_PROMPT' ? 'initial' : s.state === 'SURPRISE_REVEALED' || s.state === 'REFINEMENT' ? 'final' : null;
  const done = s.state === 'FINAL_SUBMISSION' || s.state === 'EVALUATION' || s.state === 'RESULT' || s.roundStatus === 'ended';

  return (
    <StudentShell entryNumber={entryNumber} wide
      right={left !== null ? <div className="text-right"><div className={cn('font-display text-3xl font-semibold leading-none tabular sm:text-4xl', lowTime ? 'animate-pulse-glow text-rose-300' : 'text-white')} role="timer" aria-label="Time left in Round 2">{formatMMSS(left)}</div><div className="text-xs text-muted">left in the final</div></div> : undefined}>
      {error && <Alert tone="warning" className="mb-4">{error} Retrying automatically.</Alert>}
      <StageBar state={s.state ?? 'R2_WAITING'} twistEnabled={!!s.twistEnabled} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <section className="peb-panel p-5" aria-labelledby="r2-problem">
            <div className="text-sm text-muted">Final problem</div>
            <h1 id="r2-problem" className="mt-1 text-2xl font-semibold text-white">{s.problem?.title}</h1>
            <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-200">{s.problem?.statement}</p>
            {s.problem?.instructions && <div className="mt-5"><h2 className="text-sm font-semibold text-white">Instructions</h2><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{s.problem.instructions}</p></div>}
            {s.problem?.constraints && <div className="mt-5"><h2 className="text-sm font-semibold text-white">Constraints</h2><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{s.problem.constraints}</p></div>}
          </section>
          {s.twist && (
            <section className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-5" aria-labelledby="r2-twist">
              <h2 id="r2-twist" className="flex items-center gap-2 font-semibold text-amber-50"><Sparkles className="h-4 w-4" aria-hidden="true" />Twist: {s.twist.title}</h2>
              <p className="mt-2 whitespace-pre-wrap leading-7 text-amber-50/90">{s.twist.description}</p>
            </section>
          )}
          <Questions s={s} onAnswered={load} />
        </div>
        <div className="space-y-5">
          {done ? <Submitted s={s} /> : stage ? <Editor key={stage} stage={stage} s={s} onChanged={load} /> : (
            <section className="peb-panel p-6 text-center">
              <Lock className="mx-auto h-6 w-6 text-violet-300" aria-hidden="true" />
              <h2 className="mt-3 text-xl font-semibold text-white">First attempt locked</h2>
              <p className="mx-auto mt-2 max-w-md text-slate-300">Hold tight — the organizers will reveal a twist. You’ll then refine your prompt into your final answer here.</p>
              <ReadOnly label="Your first prompt" text={s.initialPrompt} />
            </section>
          )}
        </div>
      </div>
    </StudentShell>
  );
}

function StageBar({ state, twistEnabled }: { state: string; twistEnabled: boolean }) {
  const steps = twistEnabled ? ['First attempt', 'Twist', 'Final answer', 'Submitted'] : ['Your answer', 'Submitted'];
  const idx = twistEnabled
    ? ({ INITIAL_PROMPT: 0, OUTPUT: 1, SURPRISE_REVEALED: 2, REFINEMENT: 2, FINAL_SUBMISSION: 3, EVALUATION: 3, RESULT: 3 } as Record<string, number>)[state] ?? 0
    : ['FINAL_SUBMISSION', 'EVALUATION', 'RESULT'].includes(state) ? 1 : 0;
  return (
    <ol className={cn('mb-5 flex gap-2 sm:grid', twistEnabled ? 'sm:grid-cols-4' : 'sm:grid-cols-2')}>
      {steps.map((label, i) => (
        <li key={label} aria-current={i === idx ? 'step' : undefined} className={cn('flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm', i === idx && 'flex-1',
          i === idx ? 'border-violet-400/50 bg-violet-500/10 text-white' : i < idx ? 'border-line text-slate-400' : 'border-line/60 text-faint')}>
          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', i === idx ? 'bg-peb-gradient text-white' : i < idx ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-800 text-slate-500')}>{i < idx ? <Check className="h-3 w-3" /> : i + 1}</span>
          <span className={cn('truncate', i !== idx && 'hidden sm:inline')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function ReadOnly({ label, text }: { label: string; text: string | null | undefined }) {
  return (
    <div className="mt-4 text-left">
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div className="peb-inset max-h-48 overflow-y-auto whitespace-pre-wrap p-3 text-sm text-slate-200">{text?.trim() || <span className="text-faint">Empty</span>}</div>
    </div>
  );
}

function Editor({ stage, s, onChanged }: { stage: Stage; s: R2State; onChanged: () => Promise<void> }) {
  const limits = s.limits ?? { promptWords: 400, outputChars: 8000, rationaleWords: 300 };
  const server: Fields = stage === 'initial'
    ? { prompt: s.initialPrompt ?? '', output: s.initialOutput ?? '', rationale: '' }
    : { prompt: s.finalPrompt ?? '', output: s.finalOutput ?? '', rationale: s.rationale ?? '' };
  const [f, setF] = useState<Fields>(() => {
    const b = typeof window !== 'undefined' ? readBackup(stage) : null;
    return b && (b.prompt !== server.prompt || b.output !== server.output || b.rationale !== server.rationale) && (b.prompt || b.output || b.rationale) ? b : server;
  });
  const [save, setSave] = useState<SaveState>('saved');
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const last = useRef<Fields>(server);
  const fRef = useRef(f);
  fRef.current = f;
  const overPrompt = words(f.prompt) > limits.promptWords;
  const overRationale = words(f.rationale) > limits.rationaleWords;

  const body = (x: Fields) => (stage === 'initial' ? { initialPrompt: x.prompt, initialOutput: x.output } : { finalPrompt: x.prompt, finalOutput: x.output, rationale: x.rationale });
  const persist = useCallback(async (action: 'save' | 'submit_initial' | 'submit_final') => {
    const snapshot = fRef.current;
    setSave('saving');
    try {
      await api('/api/student/round2/save', { method: 'POST', body: { action, fields: body(snapshot) }, loginPath: '/student/login' });
      last.current = snapshot;
      const same = JSON.stringify(fRef.current) === JSON.stringify(snapshot);
      setSave(same ? 'saved' : 'unsaved');
      if (same) clearBackup(stage);
      setMsg(null);
      if (action !== 'save') { clearBackup(stage); await onChanged(); }
      return true;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'round_paused' || code === 'round_closed' || code === 'waiting_for_twist' || code === 'already_submitted' || code === 'wrong_stage') {
        setSave('saved'); setMsg(errorMessage(e)); await onChanged(); return false;
      }
      if (e instanceof ApiError && e.status === 400) { setSave('error'); setMsg(e.message); return false; }
      setSave('retrying'); setMsg(null);
      return false;
    }
  }, [stage, onChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (JSON.stringify(f) === JSON.stringify(last.current)) return;
    writeBackup(stage, f);
    setSave((x) => (x === 'saving' ? x : 'unsaved'));
    if (overPrompt || overRationale || f.output.length > limits.outputChars) return;
    const t = setTimeout(() => void persist('save'), 1500);
    return () => clearTimeout(t);
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (save !== 'retrying') return;
    const t = setTimeout(() => void persist('save'), 3000);
    return () => clearTimeout(t);
  }, [save, persist]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (save === 'unsaved' || save === 'saving' || save === 'retrying') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [save]);

  const label = { saved: 'All changes saved', unsaved: 'Unsaved changes…', saving: 'Saving…', retrying: 'Connection issue — kept on this device, retrying…', error: 'Not saved' }[save];
  const blockPaste = (e: React.ClipboardEvent) => { e.preventDefault(); logPasteBlocked(); };
  const typed = (key: 'prompt' | 'rationale') => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isPasteLikeChange(f[key], e.target.value, e.nativeEvent)) { logPasteBlocked(); return; }
    setF({ ...f, [key]: e.target.value });
  };
  const field = 'w-full resize-y rounded-xl border bg-background/80 p-4 leading-7 text-slate-100 placeholder:text-faint focus:outline-none focus:ring-2';

  return (
    <>
      {stage === 'final' && s.initialPrompt && <details className="peb-panel p-4 text-sm"><summary className="cursor-pointer text-slate-300">Your first attempt (read-only)</summary><ReadOnly label="First prompt" text={s.initialPrompt} /><ReadOnly label="First AI output" text={s.initialOutput} /></details>}
      <section className="peb-panel p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="r2-prompt" className="font-medium text-white">{stage === 'initial' ? 'Your first prompt' : 'Your final prompt'}</label>
          <span className={cn('text-xs tabular', overPrompt ? 'font-semibold text-rose-300' : 'text-muted')}>{words(f.prompt)} / {limits.promptWords} words</span>
        </div>
        <textarea id="r2-prompt" className={cn(field, 'h-56', overPrompt ? 'border-rose-500/70 focus:ring-rose-500/30' : 'border-line focus:border-violet-400/60 focus:ring-violet-500/20')}
          value={f.prompt} onChange={typed('prompt')} onPaste={blockPaste} onDrop={(e) => e.preventDefault()} autoComplete="off" placeholder="Write your prompt. Typing only — pasting is disabled." />
      </section>
      <section className="peb-panel p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="r2-output" className="font-medium text-white">AI output</label>
          <span className="text-xs tabular text-muted">{f.output.length} / {limits.outputChars} characters</span>
        </div>
        <textarea id="r2-output" className={cn(field, 'h-44 border-line text-sm focus:border-violet-400/60 focus:ring-violet-500/20')} maxLength={limits.outputChars}
          value={f.output} onChange={(e) => setF({ ...f, output: e.target.value.slice(0, limits.outputChars) })} placeholder="Paste or type the response the AI gave you." />
      </section>
      {stage === 'final' && limits.rationaleWords > 0 && (
        <section className="peb-panel p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="r2-rationale" className="font-medium text-white">Why you changed it</label>
            <span className={cn('text-xs tabular', overRationale ? 'font-semibold text-rose-300' : 'text-muted')}>{words(f.rationale)} / {limits.rationaleWords} words</span>
          </div>
          <textarea id="r2-rationale" className={cn(field, 'h-32 text-sm', overRationale ? 'border-rose-500/70' : 'border-line focus:border-violet-400/60 focus:ring-violet-500/20')}
            value={f.rationale} onChange={typed('rationale')} onPaste={blockPaste} onDrop={(e) => e.preventDefault()} placeholder={s.twist ? 'Explain how you adapted your prompt to the twist.' : 'Explain the choices behind your prompt.'} />
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={cn('flex items-center gap-2 text-sm', save === 'saved' ? 'text-emerald-200' : save === 'retrying' || save === 'error' ? 'text-amber-200' : 'text-muted')} role="status" aria-live="polite">
          <span className={cn('h-2 w-2 rounded-full', save === 'saved' ? 'bg-emerald-400' : save === 'retrying' || save === 'error' ? 'bg-amber-400' : 'bg-slate-500')} aria-hidden="true" />{label}
        </span>
        <Button variant="primary" disabled={!f.prompt.trim() || overPrompt || overRationale} onClick={() => setConfirm(true)}>
          {stage === 'initial' ? 'Submit first attempt' : 'Submit final answer'}
        </Button>
      </div>
      {msg && <Alert tone="warning">{msg}</Alert>}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={stage === 'initial' ? 'Submit your first attempt?' : 'Submit your final answer?'}
        confirmLabel={stage === 'initial' ? 'Submit first attempt' : 'Submit final answer'}
        onConfirm={async () => { const ok = await persist(stage === 'initial' ? 'submit_initial' : 'submit_final'); if (!ok) throw new Error(msg ?? 'Could not submit — please try again.'); }}>
        <p>{stage === 'initial' ? 'Your first attempt is locked. You’ll refine it after the organizers reveal the twist.' : 'Your final prompt, output and explanation are locked and sent to the jury. You can still answer jury questions.'}</p>
      </ConfirmDialog>
    </>
  );
}

function Submitted({ s }: { s: R2State }) {
  return (
    <section className="peb-panel p-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-200" aria-hidden="true"><Check className="h-6 w-6" /></span>
      <h2 className="mt-3 text-2xl font-semibold text-white">Final answer submitted</h2>
      {s.submissionRef && <p className="mt-2 text-slate-300">Reference <span className="font-display text-lg font-semibold tabular text-white">{s.submissionRef}</span></p>}
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">The jury is reviewing your work. Keep this page open in case they ask you a question. Results are announced by the organizers.</p>
      <ReadOnly label="Final prompt" text={s.finalPrompt} />
      <Link href="/student/waiting" className="peb-btn-secondary mt-5">Back to my dashboard</Link>
    </section>
  );
}

function Questions({ s, onAnswered }: { s: R2State; onAnswered: () => Promise<void> }) {
  const qs = s.questions ?? [];
  const open = s.roundStatus === 'running' || s.roundStatus === 'paused';
  if (!qs.length) return null;
  return (
    <section className="peb-panel p-5" aria-labelledby="jury-q">
      <h2 id="jury-q" className="flex items-center gap-2 font-semibold text-white"><MessageSquareText className="h-4 w-4 text-violet-300" aria-hidden="true" />Questions from the jury</h2>
      <ol className="mt-3 space-y-4">{qs.map((q) => <QuestionItem key={q.id} q={q} open={open} onAnswered={onAnswered} />)}</ol>
    </section>
  );
}

function QuestionItem({ q, open, onAnswered }: { q: NonNullable<R2State['questions']>[number]; open: boolean; onAnswered: () => Promise<void> }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try { await api('/api/student/round2/answer', { method: 'POST', body: { questionId: q.id, answer }, loginPath: '/student/login' }); await onAnswered(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <li className="peb-inset p-4">
      <p className="text-slate-100">{q.question}</p>
      {q.answer ? <p className="mt-2 border-l-2 border-cyan-400/50 pl-3 text-sm text-slate-300">{q.answer}</p> : open ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`a-${q.id}`} className="sr-only">Your answer</label>
          <textarea id={`a-${q.id}`} rows={3} className="peb-input" value={answer} maxLength={4000} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer for the jury." />
          {err && <p className="text-xs text-rose-300">{err}</p>}
          <Button size="sm" variant="primary" loading={busy} disabled={!answer.trim()} onClick={() => void send()}>Send answer</Button>
        </div>
      ) : <p className="mt-2 text-sm text-faint">Not answered.</p>}
    </li>
  );
}
