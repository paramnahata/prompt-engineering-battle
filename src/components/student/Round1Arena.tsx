'use client';

import { timeoutSignal } from '@/lib/client/api';
import { isPasteLikeChange, logPasteBlocked } from '@/lib/client/no-paste';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { usePolling } from '@/hooks/usePolling';
import { formatMMSS } from '@/lib/timer';
import { Lock, Check, Pause, AlertTriangle, Target } from 'lucide-react';
import StudentShell, { StudentCenter } from './StudentShell';
import { cn } from '@/components/ui/cn';

interface AssignmentVM {
  id: string;
  position: number;
  challenge: {
    title: string;
    problem_statement: string;
    instructions: string | null;
    constraints: string | null;
    expected_output: string | null;
    prompt_word_limit: number;
    output_char_limit: number;
  };
}
interface SubmissionVM {
  id: string;
  assignment_id: string;
  position: number;
  prompt_text: string;
  ai_output_text: string;
  status: 'draft' | 'locked' | 'submitted';
  question_start_at: string | null;
  question_end_at: string | null;
  submission_ref: string | null;
}
interface StateVM {
  serverNow: string;
  roundStatus: string;
  assignments: AssignmentVM[];
  submissions: SubmissionVM[];
  currentSubmissionId: string | null;
}

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'retrying' | 'limit' | 'closed';

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

const backupKey = (submissionId: string) => `peb:draft:${submissionId}`;
function readBackup(submissionId: string): { prompt: string; output: string } | null {
  try {
    const raw = window.localStorage.getItem(backupKey(submissionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.prompt === 'string' && typeof parsed?.output === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
function writeBackup(submissionId: string, prompt: string, output: string) {
  try {
    window.localStorage.setItem(backupKey(submissionId), JSON.stringify({ prompt, output, ts: Date.now() }));
  } catch {
    // Storage may be unavailable (private mode); the server copy is still the source of truth.
  }
}
function clearBackup(submissionId: string) {
  try {
    window.localStorage.removeItem(backupKey(submissionId));
  } catch {
    // ignore
  }
}

export default function Round1Arena({ entryNumber }: { entryNumber: number | null }) {
  const [state, setState] = useState<StateVM | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [advancing, setAdvancing] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftOutput, setDraftOutput] = useState('');

  const advancingRef = useRef(false);
  const saveSeq = useRef(0);
  const lastSaved = useRef<{ id: string; prompt: string; output: string } | null>(null);
  const draftRef = useRef({ prompt: '', output: '' });
  draftRef.current = { prompt: draftPrompt, output: draftOutput };

  const goLogin = useCallback(() => window.location.replace('/student/login'), []);
  useHeartbeat(goLogin);

  const current = useMemo(
    () => state?.submissions.find((s) => s.id === state.currentSubmissionId) ?? null,
    [state],
  );
  const assignment = useMemo(
    () => (current ? state?.assignments.find((a) => a.id === current.assignment_id) ?? null : null),
    [state, current],
  );

  const fetchState = useCallback(async (): Promise<StateVM | null> => {
    try {
      const res = await fetch('/api/student/round1/state', { cache: 'no-store', signal: timeoutSignal(15_000) });
      if (res.status === 401) {
        goLogin();
        return null;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not load your challenge.');
      if (data.roundStatus === 'paused') {
        setPaused(true);
        return null;
      }
      if (data.roundStatus !== 'running') {
        window.location.replace('/student/waiting');
        return null;
      }
      setPaused(false);
      setLoadError(null);
      setState(data as StateVM);
      if (!data.currentSubmissionId && (data.assignments ?? []).length > 0) {
        const ref = (data.submissions as SubmissionVM[]).find((s) => s.submission_ref)?.submission_ref;
        window.location.replace(`/student/submitted${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
      } else if (!(data.assignments ?? []).length) {
        setLoadError('No challenges are assigned to your entry yet. Please tell an organizer — they can assign late arrivals.');
      }
      return data as StateVM;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Connection issue while loading the challenge.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [goLogin]);

  useEffect(() => {
    void fetchState().catch(() => {});
  }, [fetchState]);

  // Lightweight round-status watcher: pause / resume / stop show up within a few seconds.
  usePolling(async () => {
    const res = await fetch('/api/student/waiting/state', { cache: 'no-store', signal: timeoutSignal(10_000) });
    if (res.status === 401) return goLogin();
    if (!res.ok) throw new Error('status');
    const data = await res.json();
    if (data.status === 'paused') setPaused(true);
    else if (data.status === 'running' && paused) await fetchState();
    else if (data.status === 'ended' || data.status === 'not_started') window.location.replace('/student/waiting');
  }, 6000, { runImmediately: false });

  // Load the draft for the current challenge (server copy, or a newer local backup).
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (!current) return;
    const backup = readBackup(current.id);
    const useBackup = backup && (backup.prompt !== current.prompt_text || backup.output !== current.ai_output_text) && (backup.prompt || backup.output);
    setDraftPrompt(useBackup ? backup.prompt : current.prompt_text);
    setDraftOutput(useBackup ? backup.output : current.ai_output_text);
    lastSaved.current = { id: current.id, prompt: current.prompt_text, output: current.ai_output_text };
    setSaveState(useBackup ? 'unsaved' : 'saved');
    setNotice(useBackup ? 'Restored unsaved work from this device.' : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const wordLimit = assignment?.challenge.prompt_word_limit ?? 150;
  const charLimit = assignment?.challenge.output_char_limit ?? 1500;
  const promptWords = wordCount(draftPrompt);
  const overWordLimit = promptWords > wordLimit;

  const save = useCallback(async (): Promise<boolean> => {
    if (!current) return false;
    const { prompt, output } = draftRef.current;
    if (lastSaved.current?.id === current.id && lastSaved.current.prompt === prompt && lastSaved.current.output === output) {
      setSaveState('saved');
      return true;
    }
    if (wordCount(prompt) > wordLimit) {
      setSaveState('limit');
      return false;
    }
    const seq = ++saveSeq.current;
    setSaveState('saving');
    try {
      const res = await fetch('/api/student/round1/autosave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ submissionId: current.id, promptText: prompt, aiOutputText: output }),
        signal: timeoutSignal(15_000),
      });
      const body = await res.json().catch(() => ({}));
      if (seq !== saveSeq.current) return res.ok; // a newer save is in flight
      if (res.status === 401) {
        goLogin();
        return false;
      }
      if (res.ok) {
        lastSaved.current = { id: current.id, prompt, output };
        const stillSame = draftRef.current.prompt === prompt && draftRef.current.output === output;
        setSaveState(stillSame ? 'saved' : 'unsaved');
        if (stillSame) clearBackup(current.id);
        return true;
      }
      if (res.status === 422) {
        setSaveState('limit');
        setNotice(body.error ?? 'Over the limit for this challenge.');
        return false;
      }
      if (body.code === 'round_paused') {
        setPaused(true);
        setSaveState('unsaved');
        return false;
      }
      if (body.code === 'round_ended') {
        window.location.replace('/student/waiting');
        return false;
      }
      if (body.code === 'locked' || body.code === 'expired') {
        setSaveState('closed');
        void fetchState().catch(() => {});
        return false;
      }
      throw new Error('save failed');
    } catch {
      if (seq === saveSeq.current) setSaveState('retrying');
      return false;
    }
  }, [current, wordLimit, goLogin, fetchState]);

  // Debounced autosave (1.2s after typing stops, at most every 8s while typing) + local backup on every change.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstUnsavedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!current) return;
    const changed = !(lastSaved.current?.id === current.id && lastSaved.current.prompt === draftPrompt && lastSaved.current.output === draftOutput);
    if (!changed) return;
    writeBackup(current.id, draftPrompt, draftOutput);
    setSaveState((s) => (s === 'saving' ? s : 'unsaved'));
    firstUnsavedAt.current ??= Date.now();
    const waited = Date.now() - firstUnsavedAt.current;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      firstUnsavedAt.current = null;
      await save();
    }, waited > 8000 ? 0 : 1200);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [draftPrompt, draftOutput, current, save]);

  // Retry failed saves.
  useEffect(() => {
    if (saveState !== 'retrying') return;
    const t = setTimeout(() => { void save(); }, 3000);
    return () => clearTimeout(t);
  }, [saveState, save]);

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState === 'unsaved' || saveState === 'saving' || saveState === 'retrying') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  const advance = useCallback(async () => {
    if (!current || advancingRef.current) return;
    advancingRef.current = true;
    setAdvancing(true);
    const submissionId = current.id;
    const { prompt, output } = draftRef.current;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const res = await fetch('/api/student/round1/advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ submissionId, promptText: prompt, aiOutputText: output }),
            signal: timeoutSignal(20_000),
          });
          const body = await res.json().catch(() => ({}));
          if (res.status === 401) return goLogin();
          if (body.code === 'timer_not_expired') {
            setNotice(null);
            await fetchState().catch(() => {});
            return;
          }
          if (body.code === 'round_paused') {
            setPaused(true);
            return;
          }
          if (body.code === 'round_ended') return window.location.replace('/student/waiting');
          if (res.ok) {
            clearBackup(submissionId);
            if (body.finalSubmit) {
              window.location.replace(`/student/submitted${body.submissionRef ? `?ref=${encodeURIComponent(body.submissionRef)}` : ''}`);
              return;
            }
            await fetchState().catch(() => {});
            return;
          }
          if (res.status < 500) {
            setNotice(body.error ?? 'Could not move to the next challenge.');
            await fetchState().catch(() => {});
            return;
          }
        } catch {
          // network error: retry below
        }
        setNotice('Connection issue — retrying submission…');
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      setNotice('Could not reach the server. Your work is saved on this device; it will be submitted when the connection returns.');
      await fetchState().catch(() => {});
    } finally {
      advancingRef.current = false;
      setAdvancing(false);
    }
  }, [current, fetchState, goLogin]);

  const onResync = useCallback(async () => {
    const data = await fetchState().catch(() => null);
    const sub = data?.submissions.find((s) => s.id === data.currentSubmissionId);
    return sub?.question_end_at && data ? { endAtIso: sub.question_end_at, serverNowIso: data.serverNow } : null;
  }, [fetchState]);

  const secondsLeft = useServerCountdown({
    endAtIso: paused ? null : current?.question_end_at ?? null,
    serverNowIso: state?.serverNow ?? null,
    onExpire: advance,
    onResync,
    resyncIntervalMs: 30_000,
  });

  // Integrity telemetry (best effort).
  useEffect(() => {
    const log = (event_type: string) => {
      fetch('/api/student/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type }), keepalive: true }).catch(() => {});
    };
    const blockCtx = (e: MouseEvent) => e.preventDefault();
    const onVisibility = () => log(document.hidden ? 'tab_hidden' : 'tab_visible');
    const onBlur = () => log('window_blur');
    document.addEventListener('contextmenu', blockCtx);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('contextmenu', blockCtx);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const blockPaste = (e: React.ClipboardEvent) => { e.preventDefault(); logPasteBlocked(); };
  const blockCopy = (e: React.ClipboardEvent) => e.preventDefault();

  if (paused) {
    return (
      <StudentCenter entryNumber={entryNumber} icon={<Pause className="h-6 w-6" />} title="Round paused">
        The organizer paused Round 1. Your timer is frozen and your work is saved. This screen continues on its own when the round resumes.
      </StudentCenter>
    );
  }

  if (!current || !assignment) {
    return (
      <StudentCenter entryNumber={entryNumber} icon={loadError ? <AlertTriangle className="h-6 w-6" /> : <Check className="h-6 w-6" />}
        title={loading ? 'Preparing your challenges…' : loadError ? 'Challenge unavailable' : 'Round complete'}
        action={loadError ? <button className="peb-btn-primary w-full" onClick={() => { setLoading(true); void fetchState().catch(() => {}); }}>Try again</button> : undefined}>
        {loading ? 'Loading your assigned challenges and saved work.' : loadError ?? 'Your answers are submitted. Taking you to your confirmation…'}
      </StudentCenter>
    );
  }

  const isLast = assignment.position === 4;
  const timeUp = secondsLeft === 0;
  const lowTime = secondsLeft !== null && secondsLeft <= 30;
  const totalSeconds = current.question_start_at && current.question_end_at
    ? Math.max(1, (new Date(current.question_end_at).getTime() - new Date(current.question_start_at).getTime()) / 1000) : null;
  const elapsedPct = totalSeconds && secondsLeft !== null ? Math.min(100, Math.max(0, 100 - (secondsLeft / totalSeconds) * 100)) : 0;
  const saveLabel: Record<SaveState, string> = {
    idle: '',
    unsaved: 'Unsaved changes…',
    saving: 'Saving…',
    saved: 'All changes saved',
    retrying: 'Connection issue — kept on this device, retrying…',
    limit: 'Not saved — over the limit',
    closed: 'This challenge is closed',
  };
  const titles = new Map(state?.assignments.map((a) => [a.position, a.challenge.title]) ?? []);

  return (
    <StudentShell entryNumber={entryNumber} wide
      right={
        <div className="text-right" aria-live="off">
          <div className={cn('font-display text-3xl font-semibold leading-none tabular sm:text-4xl', lowTime ? 'animate-pulse-glow text-rose-300' : 'text-white')} role="timer" aria-label="Time left for this challenge">
            {secondsLeft !== null ? formatMMSS(secondsLeft) : '--:--'}
          </div>
          <div className="text-xs text-muted">left on this challenge</div>
        </div>
      }
      below={<div className="h-1 bg-slate-800" aria-hidden="true"><div className={cn('h-full transition-[width] duration-1000 ease-linear', lowTime ? 'bg-rose-400' : 'bg-peb-gradient')} style={{ width: `${elapsedPct}%` }} /></div>}>
      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label={`Challenge ${assignment.position} of 4`}>
        {[1, 2, 3, 4].map((p) => {
          const done = p < assignment.position;
          const active = p === assignment.position;
          return (
            <li key={p} aria-current={active ? 'step' : undefined}
              className={cn('flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-xs sm:text-sm',
                active ? 'border-violet-400/50 bg-violet-500/10 text-white' : done ? 'border-line bg-surface/60 text-slate-400' : 'border-line/60 text-faint')}>
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', active ? 'bg-peb-gradient text-white' : done ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-800 text-slate-500')}>
                {done ? <Check className="h-3 w-3" aria-label="submitted" /> : p}
              </span>
              <span className="hidden truncate sm:inline">{active || done ? titles.get(p) ?? `Challenge ${p}` : p <= 2 ? 'Common challenge' : 'Your challenge'}</span>
              {!active && !done && <Lock className="ml-auto hidden h-3 w-3 shrink-0 sm:block" aria-label="locked" />}
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="peb-panel self-start p-5 lg:sticky lg:top-24" aria-labelledby="challenge-title">
          <div className="text-sm text-muted">Challenge {assignment.position} of 4</div>
          <h1 id="challenge-title" className="mt-1 text-2xl font-semibold text-white">{assignment.challenge.title}</h1>
          <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-200">{assignment.challenge.problem_statement}</p>
          {assignment.challenge.instructions && (
            <div className="mt-5"><h2 className="text-sm font-semibold text-white">Instructions</h2><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{assignment.challenge.instructions}</p></div>
          )}
          {assignment.challenge.constraints && (
            <div className="mt-5"><h2 className="text-sm font-semibold text-white">Constraints</h2><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{assignment.challenge.constraints}</p></div>
          )}
          {assignment.challenge.expected_output && (
            <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-cyan-100"><Target className="h-4 w-4" aria-hidden="true" />What a good output looks like</h2>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-200">{assignment.challenge.expected_output}</p>
            </div>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line/70 pt-4 text-sm">
            <div><dt className="text-muted">Prompt limit</dt><dd className="font-semibold text-white">{wordLimit} words</dd></div>
            <div><dt className="text-muted">AI output limit</dt><dd className="font-semibold text-white">{charLimit} characters</dd></div>
          </dl>
        </section>

        <section className="flex flex-col gap-4">
          <div className="peb-panel p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="prompt-input" className="font-medium text-white">Your prompt</label>
              <span className={cn('text-xs tabular', overWordLimit ? 'font-semibold text-rose-300' : 'text-muted')}>{promptWords} / {wordLimit} words</span>
            </div>
            <textarea
              id="prompt-input"
              className={cn('h-52 w-full resize-y rounded-xl border bg-background/80 p-4 leading-7 text-slate-100 placeholder:text-faint focus:outline-none focus:ring-2',
                overWordLimit ? 'border-rose-500/70 focus:ring-rose-500/30' : 'border-line focus:border-violet-400/60 focus:ring-violet-500/20')}
              value={draftPrompt}
              onChange={(e) => { if (isPasteLikeChange(draftPrompt, e.target.value, e.nativeEvent)) { logPasteBlocked(); return; } setDraftPrompt(e.target.value); }}
              autoComplete="off"
              onPaste={blockPaste}
              onCopy={blockCopy}
              onCut={blockCopy}
              onDrop={(e) => e.preventDefault()}
              placeholder="Write the prompt you gave the AI tool. Typing only — pasting is disabled."
              aria-describedby="prompt-help"
              disabled={timeUp && advancing}
            />
            <p id="prompt-help" className={cn('mt-1.5 text-xs', overWordLimit ? 'text-rose-300' : 'text-faint')}>
              {overWordLimit ? `${promptWords - wordLimit} word${promptWords - wordLimit === 1 ? '' : 's'} over the limit — trim it, or the last saved version is submitted.` : 'Saved automatically as you type.'}
            </p>
          </div>
          <div className="peb-panel p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="output-input" className="font-medium text-white">AI output</label>
              <span className="text-xs tabular text-muted">{draftOutput.length} / {charLimit} characters</span>
            </div>
            <textarea
              id="output-input"
              className="h-44 w-full resize-y rounded-xl border border-line bg-background/80 p-4 text-sm leading-6 text-slate-100 placeholder:text-faint focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              value={draftOutput}
              onChange={(e) => setDraftOutput(e.target.value.slice(0, charLimit))}
              maxLength={charLimit}
              placeholder="Paste or type the response the AI gave you."
              disabled={timeUp && advancing}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={cn('flex items-center gap-2 text-sm', saveState === 'retrying' || saveState === 'limit' ? 'text-amber-200' : saveState === 'saved' ? 'text-emerald-200' : 'text-muted')} role="status" aria-live="polite">
              <span className={cn('h-2 w-2 rounded-full', saveState === 'saved' ? 'bg-emerald-400' : saveState === 'retrying' || saveState === 'limit' ? 'bg-amber-400' : 'bg-slate-500')} aria-hidden="true" />
              {saveLabel[saveState]}
            </span>
            <button className="peb-btn-primary min-w-44" onClick={() => void advance()} disabled={!timeUp || advancing || overWordLimit}>
              {advancing ? 'Submitting…' : !timeUp && secondsLeft !== null ? `Next opens in ${formatMMSS(secondsLeft)}` : isLast ? 'Submit final answer' : 'Submit and continue'}
            </button>
          </div>
          {notice && <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-50" role="status">{notice}</p>}
          <p className="text-sm text-muted">When the timer ends, your answer is submitted automatically and the next challenge opens. Submitted challenges can&apos;t be reopened.</p>
        </section>
      </div>
    </StudentShell>
  );
}
