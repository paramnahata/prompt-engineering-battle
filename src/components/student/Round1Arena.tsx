'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { usePolling } from '@/hooks/usePolling';
import { formatMMSS } from '@/lib/timer';
import LogoutButton from '@/components/auth/LogoutButton';

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
      const res = await fetch('/api/student/round1/state', { cache: 'no-store' });
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
    const res = await fetch('/api/student/waiting/state', { cache: 'no-store' });
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

  const blockPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    fetch('/api/student/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: 'paste_blocked' }) }).catch(() => {});
  };
  const blockCopy = (e: React.ClipboardEvent) => e.preventDefault();

  if (paused) {
    return (
      <CenteredCard icon="Ⅱ" title="Round paused" entryNumber={entryNumber}>
        The organizer paused Round 1. Your timer is frozen and your work is saved. This screen continues automatically when the round resumes.
      </CenteredCard>
    );
  }

  if (!current || !assignment) {
    return (
      <CenteredCard icon={loading ? '…' : loadError ? '!' : '✓'} title={loading ? 'Preparing your arena' : loadError ? 'Challenge unavailable' : 'Round completed'} entryNumber={entryNumber}>
        <span>{loading ? 'Syncing your assigned challenges and saved work…' : loadError ?? 'Your submissions are complete. Redirecting…'}</span>
        {loadError && (
          <button className="peb-btn-primary mt-6 w-full" onClick={() => { setLoading(true); void fetchState().catch(() => {}); }}>
            Retry
          </button>
        )}
      </CenteredCard>
    );
  }

  const isLast = assignment.position === 4;
  const timeUp = secondsLeft === 0;
  const lowTime = secondsLeft !== null && secondsLeft <= 30;
  const saveLabel: Record<SaveState, string> = {
    idle: '',
    unsaved: 'Unsaved changes…',
    saving: 'Saving…',
    saved: 'All changes saved',
    retrying: 'Connection issue — kept on this device, retrying…',
    limit: 'Not saved — over the limit',
    closed: 'This challenge is closed',
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur-xl sm:px-8">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-300">Live Arena{entryNumber !== null ? ` · Entry ${entryNumber}` : ''}</div>
          <div className="mt-1 text-lg font-bold sm:text-xl">Challenge {assignment.position} <span className="font-normal text-slate-500">/ 4</span></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right" aria-live="off">
            <div className={`font-mono text-2xl tabular-nums sm:text-3xl ${lowTime ? 'animate-pulse-glow text-red-400' : ''}`} role="timer" aria-label="Time left for this challenge">
              {secondsLeft !== null ? formatMMSS(secondsLeft) : '--:--'}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">this challenge</div>
          </div>
          <LogoutButton redirectTo="/student/login" />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-8">
        <div className="flex gap-1.5" aria-label={`Challenge ${assignment.position} of 4`}>
          {[1, 2, 3, 4].map((p) => (
            <div key={p} className={`h-1.5 flex-1 rounded-full ${p < assignment.position ? 'bg-cyan-300/70' : p === assignment.position ? 'bg-gradient-to-r from-violet-500 to-cyan-300' : 'bg-white/10'}`} />
          ))}
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-5 p-4 sm:p-8 lg:grid-cols-2 lg:gap-6">
        <section className="peb-card" aria-labelledby="challenge-title">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Challenge brief</p>
          <h2 id="challenge-title" className="mt-2 text-xl font-bold tracking-tight">{assignment.challenge.title}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{assignment.challenge.problem_statement}</p>
          {assignment.challenge.instructions && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-semibold">Instructions</h3>
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{assignment.challenge.instructions}</p>
            </>
          )}
          {assignment.challenge.constraints && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-semibold">Constraints</h3>
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{assignment.challenge.constraints}</p>
            </>
          )}
          <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted">
            <div>Prompt limit: <span className="text-foreground">{wordLimit} words</span></div>
            <div>AI output limit: <span className="text-foreground">{charLimit} characters</span></div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="peb-card">
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="prompt-input" className="text-sm font-medium">Your prompt</label>
              <span className={`text-xs tabular-nums ${overWordLimit ? 'font-semibold text-red-400' : 'text-muted'}`}>{promptWords} / {wordLimit} words</span>
            </div>
            <textarea
              id="prompt-input"
              className={`mt-2 h-44 w-full resize-y rounded-xl border bg-slate-950/70 p-4 text-sm leading-6 focus:outline-none focus:ring-1 ${overWordLimit ? 'border-red-500 focus:ring-red-500' : 'border-border focus:ring-accent'}`}
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              onPaste={blockPaste}
              onCopy={blockCopy}
              onCut={blockCopy}
              onDrop={(e) => e.preventDefault()}
              placeholder="Type the prompt you gave the AI tool…"
              disabled={timeUp && advancing}
            />
            {overWordLimit && <p className="mt-1 text-xs text-red-400">{promptWords - wordLimit} word{promptWords - wordLimit === 1 ? '' : 's'} over the limit — trim it, or the last saved version will be submitted.</p>}
          </div>
          <div className="peb-card">
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="output-input" className="text-sm font-medium">AI output</label>
              <span className="text-xs tabular-nums text-muted">{draftOutput.length} / {charLimit} chars</span>
            </div>
            <textarea
              id="output-input"
              className="h-40 w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              value={draftOutput}
              onChange={(e) => setDraftOutput(e.target.value.slice(0, charLimit))}
              maxLength={charLimit}
              placeholder="Paste the AI's output here…"
              disabled={timeUp && advancing}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`text-xs ${saveState === 'retrying' || saveState === 'limit' ? 'text-amber-300' : 'text-muted'}`} role="status" aria-live="polite">{saveLabel[saveState]}</span>
            <button className="peb-btn-primary" onClick={() => void advance()} disabled={!timeUp || advancing || overWordLimit}>
              {advancing ? 'Submitting…' : !timeUp && secondsLeft !== null ? `Next opens in ${formatMMSS(secondsLeft)}` : isLast ? 'Final submit' : 'Save & next'}
            </button>
          </div>
          {notice && <p className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-2 text-xs text-amber-100" role="status">{notice}</p>}
          <p className="text-right text-xs text-muted">When the timer ends your answer is submitted automatically and the next challenge opens. You can&apos;t return to a previous challenge.</p>
        </section>
      </main>

      {entryNumber !== null && (
        <div className="pointer-events-none fixed bottom-3 right-3 select-none text-xs text-muted/50" aria-hidden="true">Entry {entryNumber}</div>
      )}
    </div>
  );
}

function CenteredCard({ icon, title, entryNumber, children }: { icon: string; title: string; entryNumber: number | null; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-violet-950/30">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-2xl text-violet-200" aria-hidden="true">{icon}</div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Prompt Engineering Battle{entryNumber !== null ? ` · Entry ${entryNumber}` : ''}</p>
        <h1 className="mt-3 text-2xl font-bold">{title}</h1>
        <div className="mt-3 text-sm leading-6 text-slate-400" aria-live="polite">{children}</div>
      </section>
    </main>
  );
}
