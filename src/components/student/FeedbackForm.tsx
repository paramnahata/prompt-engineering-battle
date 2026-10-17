'use client';

import { useCallback, useState } from 'react';
import { MessageSquareHeart, Star } from 'lucide-react';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { timeoutSignal } from '@/lib/client/api';
import { cn } from '@/components/ui/cn';
import StudentShell from './StudentShell';

type Level = 'too_easy' | 'just_right' | 'too_hard';
type Again = 'yes' | 'maybe' | 'no';

function Stars({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  const words = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  return (
    <fieldset>
      <legend id={id} className="font-medium text-white">{label} <span className="text-rose-300">*</span></legend>
      <div className="mt-2 flex items-center gap-1.5" role="radiogroup" aria-labelledby={id}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} — ${words[n]}`} onClick={() => onChange(n)}
            className="rounded-md p-1.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
            <Star className={cn('h-8 w-8', n <= value ? 'fill-amber-300 text-amber-300' : 'text-slate-600')} aria-hidden="true" />
          </button>
        ))}
        <span className="ml-2 text-sm text-muted">{value ? words[value] : 'Tap a star'}</span>
      </div>
    </fieldset>
  );
}

function Choice<T extends string>({ id, label, options, value, onChange }: { id: string; label: string; options: [T, string][]; value: T | null; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend id={id} className="font-medium text-white">{label} <span className="text-rose-300">*</span></legend>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={cn('rounded-full border px-4 py-2 text-sm transition-colors', value === v ? 'border-violet-400/70 bg-violet-500/20 text-white' : 'border-line text-slate-300 hover:border-slate-500')}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Required Round 1 feedback. Answers are already locked; the dashboard opens once this is sent. */
export default function FeedbackForm({ entryNumber, submissionRef }: { entryNumber: number | null; submissionRef: string | null }) {
  useHeartbeat(useCallback(() => window.location.replace('/student/login'), []));
  const [overall, setOverall] = useState(0);
  const [system, setSystem] = useState(0);
  const [management, setManagement] = useState(0);
  const [level, setLevel] = useState<Level | null>(null);
  const [again, setAgain] = useState<Again | null>(null);
  const [liked, setLiked] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = [!overall && 'overall rating', !system && 'system rating', !management && 'management rating', !level && 'challenge level', !again && 'join again', liked.trim().length < 2 && 'what you liked'].filter(Boolean) as string[];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (missing.length) { setError(`Please answer: ${missing.join(', ')}.`); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/student/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: timeoutSignal(20_000),
        body: JSON.stringify({ overall, system, management, challengeLevel: level, joinAgain: again, liked: liked.trim(), suggestions: suggestions.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) return window.location.replace('/student/login');
      if (!res.ok) throw new Error(body.error ?? 'Could not save your feedback.');
      window.location.replace(`/student/submitted${submissionRef ? `?ref=${encodeURIComponent(submissionRef)}` : ''}`);
    } catch (err) {
      setError(err instanceof Error && err.name !== 'AbortError' ? err.message : 'Connection problem — please try again.');
      setBusy(false);
    }
  }

  const box = 'w-full rounded-xl border border-line bg-background/80 p-3 text-sm leading-6 text-slate-100 placeholder:text-faint focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20';
  return (
    <StudentShell entryNumber={entryNumber}>
      <form onSubmit={submit} className="peb-panel mx-auto max-w-2xl space-y-6 p-6 sm:p-8" noValidate>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200" aria-hidden="true"><MessageSquareHeart className="h-6 w-6" /></span>
          <div>
            <h1 className="text-2xl font-semibold text-white">One last step: your feedback</h1>
            <p className="mt-1 text-sm leading-6 text-slate-300">Your Round 1 answers are saved and locked. Tell us how it went — Round 1 is complete once you send this. It takes a minute.</p>
          </div>
        </div>
        <Stars id="fb-overall" label="Overall, how was the event?" value={overall} onChange={setOverall} />
        <Stars id="fb-system" label="How was the system (website, timer, saving)?" value={system} onChange={setSystem} />
        <Stars id="fb-management" label="How was the management and organisation?" value={management} onChange={setManagement} />
        <Choice id="fb-level" label="The challenges were…" value={level} onChange={setLevel} options={[['too_easy', 'Too easy'], ['just_right', 'Just right'], ['too_hard', 'Too hard']]} />
        <Choice id="fb-again" label="Would you take part again?" value={again} onChange={setAgain} options={[['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']]} />
        <div>
          <label htmlFor="fb-liked" className="font-medium text-white">What did you like the most? <span className="text-rose-300">*</span></label>
          <textarea id="fb-liked" className={cn(box, 'mt-2 h-24')} maxLength={1000} value={liked} onChange={(e) => setLiked(e.target.value)} placeholder="One thing that worked well for you." />
        </div>
        <div>
          <label htmlFor="fb-more" className="font-medium text-white">We’d like to hear from you</label>
          <p className="text-xs text-muted">Anything we should improve, or anything else you want to tell us (optional).</p>
          <textarea id="fb-more" className={cn(box, 'mt-2 h-28')} maxLength={2000} value={suggestions} onChange={(e) => setSuggestions(e.target.value)} placeholder="Your suggestions…" />
        </div>
        {error && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p>}
        <button type="submit" className="peb-btn-primary w-full min-h-[3rem]" disabled={busy}>{busy ? 'Sending…' : 'Send feedback and finish Round 1'}</button>
      </form>
    </StudentShell>
  );
}
