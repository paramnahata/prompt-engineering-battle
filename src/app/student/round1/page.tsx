'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';

interface AssignmentVM {
  id: string; // assignment id
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
  question_end_at: string | null;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export default function Round1Page() {
  const [assignments, setAssignments] = useState<AssignmentVM[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionVM[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [serverNowIso, setServerNowIso] = useState<string | null>(null);
  const [roundEndAt, setRoundEndAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'offline' | 'over_limit'>('idle');
  const [limitError, setLimitError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/student/round1/state');
      const data = await res.json();
      setServerNowIso(data.serverNow);
      setRoundEndAt(data.roundEndAt ?? null);
      if (data.assignments) setAssignments(data.assignments);
      if (data.submissions) setSubmissions(data.submissions);
      setOffline(false);
      return { endAtIso: data.roundEndAt as string, serverNowIso: data.serverNow as string };
    } catch {
      setOffline(true);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const secondsLeft = useServerCountdown({
    endAtIso: roundEndAt,
    serverNowIso,
    onResync: fetchState,
  });

  const activeAssignment = assignments[activeIndex];
  const activeSubmission = submissions.find((s) => s.assignment_id === activeAssignment?.id);
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

  // Debounced autosave (~5s), skipped when offline (kept locally instead).
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
        if (!res.ok) throw new Error('save failed');
        setLimitError(null);
        setSaveState('saved');
      } catch {
        setSaveState('offline'); // draft stays in local state either way
      }
    }, 5000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPrompt, draftOutput]);

  // Anti-cheating: block context menu / copy-paste-cut in the prompt field,
  // log tab visibility + window blur. This is deterrence + logging, not a
  // guarantee — see docs/ARCHITECTURE.md.
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

  const canAdvance = !overWordLimit && !overCharLimit;

  const goNext = () => {
    if (!canAdvance) return;
    setActiveIndex((i) => i + 1);
  };

  if (!activeAssignment) {
    return <div className="min-h-screen flex items-center justify-center text-muted">Loading challenge…</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10">
        <div>
          <div className="text-sm text-muted">PROMPT ENGINEERING BATTLE — Round 1</div>
          <div className="text-lg font-semibold">Challenge {activeAssignment.position} of 4</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-mono ${secondsLeft !== null && secondsLeft < 60 ? 'text-red-400 animate-pulse-glow' : ''}`}>
            {secondsLeft !== null ? formatMMSS(secondsLeft) : '--:--'}
          </div>
          {offline && <div className="text-xs text-amber-400">Offline — changes saved locally</div>}
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6 max-w-7xl mx-auto">
        <section className="peb-card">
          <h2 className="font-semibold mb-2">{activeAssignment.challenge.title}</h2>
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
              className={`w-full h-40 bg-surface border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 ${
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
            <div className="flex gap-2">
              <button
                className="peb-btn-secondary"
                disabled={activeIndex === 0}
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              >
                Previous
              </button>
              {activeIndex < assignments.length - 1 ? (
                <button className="peb-btn-primary" onClick={goNext} disabled={!canAdvance}>
                  Save &amp; Next
                </button>
              ) : (
                <button className="peb-btn-primary" disabled={!canAdvance}>
                  Final Submit
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      <div className="fixed bottom-3 right-3 text-xs text-muted/60 select-none pointer-events-none">
        {/* Entry ID watermark — replace with real session entry code */}
        ENTRY WATERMARK
      </div>
    </div>
  );
}
