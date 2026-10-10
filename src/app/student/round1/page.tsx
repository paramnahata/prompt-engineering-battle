'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';

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
  prompt_text: string;
  ai_output_text: string;
  status: 'draft' | 'locked' | 'submitted';
  question_start_at: string | null;
  question_end_at: string | null;
  submission_ref: string | null;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function BattleIntro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 cursor-pointer"
      onClick={onDone}
    >
      <div className="flex items-center gap-2 text-6xl animate-[clash_1.2s_ease-out]">
        <span className="inline-block -rotate-45">⚔️</span>
        <span className="inline-block rotate-45">⚔️</span>
      </div>
      <div className="text-3xl font-bold tracking-[0.3em] bg-gradient-to-r from-accent via-accent-blue to-accent-cyan bg-clip-text text-transparent animate-[fadein_1.5s_ease-out]">
        ROUND 1
      </div>
      <div className="text-muted text-sm">Tap to skip</div>
      <style jsx>{`
        @keyframes clash {
          0% { transform: scale(0.4) translateX(-40px); opacity: 0; }
          60% { transform: scale(1.15) translateX(0); opacity: 1; }
          100% { transform: scale(1) translateX(0); opacity: 1; }
        }
        @keyframes fadein {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default function Round1Page() {
  const router = useRouter();
  const [showIntro, setShowIntro] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentVM[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionVM[]>([]);
  const [currentSubmissionId, setCurrentSubmissionId] = useState<string | null>(null);
  const [serverNowIso, setServerNowIso] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'offline' | 'over_limit'>('idle');
  const [limitError, setLimitError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const advancedRef = useRef(false);

  const fetchState = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/student/round1/state', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.replace('/student/login');
        return null;
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not load your challenge.');
      if (data.roundStatus && data.roundStatus !== 'running') {
        router.replace('/student/waiting');
        return null;
      }
      setServerNowIso(data.serverNow ?? null);
      setAssignments(data.assignments ?? []);
      setSubmissions(data.submissions ?? []);
      setCurrentSubmissionId(data.currentSubmissionId ?? null);
      setOffline(false);
      if (!(data.assignments ?? []).length) {
        setLoadError('No challenges are assigned to this entry yet. Please ask the organizer to check your attendance and assignments.');
      }
      const activeSub = (data.submissions ?? []).find((s: SubmissionVM) => s.id === data.currentSubmissionId);
      return activeSub?.question_end_at
        ? { endAtIso: activeSub.question_end_at as string, serverNowIso: data.serverNow as string }
        : null;
    } catch (err) {
      setOffline(true);
      setLoadError(err instanceof Error ? err.message : 'Connection issue while loading the challenge.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Keep the arena in sync if the organizer stops or pauses the round.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/student/waiting/state', { cache: 'no-store' });
        if (res.status === 401) {
          router.replace('/student/login');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.status !== 'running') router.replace('/student/waiting');
      } catch {
        // A transient status check failure should not interrupt the challenge.
      }
    }, 10000);
    return () => clearInterval(id);
  }, [router]);

  const activeSubmission = submissions.find((s) => s.id === currentSubmissionId);
  const activeAssignment = assignments.find((a) => a.id === activeSubmission?.assignment_id);
  const allDone = assignments.length > 0 && !activeSubmission;

  useEffect(() => {
    if (allDone) {
      const ref = submissions.find((s) => s.submission_ref)?.submission_ref;
      router.push(`/student/submitted${ref ? `?ref=${ref}` : ''}`);
    }
  }, [allDone, submissions, router]);

  const advance = useCallback(async () => {
    if (!activeSubmission || advancedRef.current) return;
    advancedRef.current = true;
    setAdvancing(true);
    try {
      const res = await fetch('/api/student/round1/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: activeSubmission.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.roundEnded) {
        router.replace('/student/waiting');
        return;
      }
      if (!res.ok) {
        setLoadError(body.error ?? 'Could not submit this challenge. Please retry.');
        return;
      }
      await fetchState();
    } finally {
      setAdvancing(false);
      advancedRef.current = false;
    }
  }, [activeSubmission, fetchState]);

  const secondsLeft = useServerCountdown({
    endAtIso: activeSubmission?.question_end_at ?? null,
    serverNowIso,
    onExpire: advance,
    onResync: fetchState,
  });

  const wordLimit = activeAssignment?.challenge.prompt_word_limit ?? 150;
  const charLimit = activeAssignment?.challenge.output_char_limit ?? 1500;

  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftOutput, setDraftOutput] = useState('');
  useEffect(() => {
    setDraftPrompt(activeSubmission?.prompt_text ?? '');
    setDraftOutput(activeSubmission?.ai_output_text ?? '');
    setLimitError(null);
  }, [activeSubmission?.id]);

  const promptWords = wordCount(draftPrompt);
  const overWordLimit = promptWords > wordLimit;
  const overCharLimit = draftOutput.length > charLimit;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSubmission) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('idle');
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const res = await fetch('/api/student/round1/autosave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId: activeSubmission.id,
            promptText: draftPrompt,
            aiOutputText: draftOutput,
          }),
        });
        if (res.status === 422) {
          const body = await res.json().catch(() => ({}));
          setSaveState('over_limit');
          setLimitError(body.error ?? 'Over the limit for this challenge.');
          return;
        }
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));
          if (body.roundEnded || body.roundPaused) {
            router.replace('/student/waiting');
            return;
          }
          setSaveState('offline');
          setLimitError(body.error ?? 'This challenge is locked or its timer has expired.');
          return;
        }
        if (!res.ok) throw new Error('save failed');
        setLimitError(null);
        setSaveState('saved');
      } catch {
        setSaveState('offline');
      }
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPrompt, draftOutput]);

  // Anti-cheating: block right-click everywhere on this page, log tab/blur events.
  useEffect(() => {
    const logEvent = (event_type: string) => {
      fetch('/api/student/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type }),
      }).catch(() => {});
    };
    const blockCtx = (e: MouseEvent) => e.preventDefault();
    const onVisibility = () => logEvent(document.hidden ? 'tab_hidden' : 'tab_visible');
    const onBlur = () => logEvent('window_blur');
    document.addEventListener('contextmenu', blockCtx);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('contextmenu', blockCtx);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const blockClipboard = (e: React.ClipboardEvent) => e.preventDefault();
  const canAdvance = !overWordLimit && !overCharLimit && !advancing;
  const isLastChallenge = activeAssignment?.position === 4;

  if (showIntro) {
    return <BattleIntro onDone={() => setShowIntro(false)} />;
  }

  if (!activeAssignment || !activeSubmission) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-violet-950/30">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-2xl text-violet-200">
            {loading ? '…' : loadError ? '!' : '✓'}
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Prompt Engineering Battle</p>
          <h1 className="mt-3 text-2xl font-bold">{loading ? 'Preparing your arena' : loadError ? 'Challenge unavailable' : 'Round completed'}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {loading ? 'Syncing your assigned challenges and saved work…' : loadError ?? 'Your submissions are complete. Redirecting to your result screen.'}
          </p>
          {loadError && <button className="peb-btn-primary mt-6 w-full" onClick={() => { setLoading(true); void fetchState(); }}>Retry loading</button>}
          {!loading && !loadError && <button className="peb-btn-secondary mt-6 w-full" onClick={() => router.replace('/student/waiting')}>Return to waiting room</button>}
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-slate-950/85 px-5 py-4 backdrop-blur-xl sm:px-8">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-300">Prompt Engineering Battle · Live Arena</div>
          <div className="mt-1 text-lg font-bold sm:text-xl">Challenge {activeAssignment.position} <span className="font-normal text-slate-500">/ 4</span></div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-mono ${secondsLeft !== null && secondsLeft < 30 ? 'text-red-400 animate-pulse-glow' : ''}`}>
            {secondsLeft !== null ? formatMMSS(secondsLeft) : '--:--'}
          </div>
          {offline && <div className="text-xs text-amber-400">Connection issue · retrying</div>}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 pt-5 sm:px-8">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          <span>Challenge progress</span><span>{Math.round((activeAssignment.position / 4) * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-400 to-cyan-300 transition-all duration-500" style={{ width: `${(activeAssignment.position / 4) * 100}%` }} />
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-5 p-5 lg:grid-cols-2 lg:gap-6 sm:p-8">
        <section className="peb-card">
          <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Challenge brief</p><h2 className="mt-2 text-xl font-bold tracking-tight">{activeAssignment.challenge.title}</h2></div><span className="rounded-xl border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-xs font-semibold text-violet-200">#{activeAssignment.position}</span></div>
          <p className="text-sm text-muted whitespace-pre-wrap mb-3">{activeAssignment.challenge.problem_statement}</p>
          {activeAssignment.challenge.instructions && (
            <>
              <h3 className="text-sm font-medium mt-3 mb-1">Instructions</h3>
              <p className="text-sm text-muted whitespace-pre-wrap">{activeAssignment.challenge.instructions}</p>
            </>
          )}
          {activeAssignment.challenge.constraints && (
            <>
              <h3 className="text-sm font-medium mt-3 mb-1">Constraints</h3>
              <p className="text-sm text-muted whitespace-pre-wrap">{activeAssignment.challenge.constraints}</p>
            </>
          )}
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted space-y-1">
            <div>Prompt limit: <span className="text-foreground">{wordLimit} words</span></div>
            <div>AI output limit: <span className="text-foreground">{charLimit} characters</span></div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="peb-card">
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Your Prompt</label>
              <span className={`text-xs ${overWordLimit ? 'text-red-400 font-semibold' : 'text-muted'}`}>
                {promptWords} / {wordLimit} words
              </span>
            </div>
            <textarea
              className={`mt-2 w-full h-44 rounded-xl border bg-slate-950/70 p-4 text-sm leading-6 resize-y focus:outline-none focus:ring-1 ${
                overWordLimit ? 'border-red-500 focus:ring-red-500' : 'border-border focus:ring-accent'
              }`}
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              onPaste={blockClipboard}
              onCopy={blockClipboard}
              onCut={blockClipboard}
              onDrop={(e) => e.preventDefault()}
              placeholder="Write the prompt you gave the AI tool…"
            />
            {overWordLimit && (
              <p className="text-xs text-red-400 mt-1">
                {promptWords - wordLimit} word{promptWords - wordLimit === 1 ? '' : 's'} over the limit — trim it before continuing.
              </p>
            )}
          </div>
          <div className="peb-card">
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">AI Output</label>
              <span className={`text-xs ${overCharLimit ? 'text-red-400 font-semibold' : 'text-muted'}`}>
                {draftOutput.length} / {charLimit} chars
              </span>
            </div>
            <textarea
              className={`w-full h-40 bg-surface border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 ${
                overCharLimit ? 'border-red-500 focus:ring-red-500' : 'border-border focus:ring-accent'
              }`}
              value={draftOutput}
              onChange={(e) => setDraftOutput(e.target.value.slice(0, charLimit))}
              maxLength={charLimit}
              placeholder="Paste the AI's output here…"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'offline' && 'Offline — changes saved locally'}
              {saveState === 'over_limit' && <span className="text-red-400">{limitError}</span>}
            </span>
            <button className="peb-btn-primary" onClick={advance} disabled={!canAdvance}>
              {advancing ? 'Submitting…' : isLastChallenge ? 'Final Submit' : 'Save & Next'}
            </button>
          </div>
          <p className="text-xs text-muted text-right">Once you move on, you can't come back to this challenge.</p>
        </section>
      </main>

      <div className="fixed bottom-3 right-3 text-xs text-muted/60 select-none pointer-events-none">
        ENTRY WATERMARK
      </div>
    </div>
  );
}
