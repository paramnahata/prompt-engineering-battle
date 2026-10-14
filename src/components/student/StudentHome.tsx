'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Check, Clock, Megaphone, Pause, Trophy } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { api, ApiError } from '@/lib/client/api';
import { timeAgo } from '@/lib/client/activity';
import { Alert } from '@/components/ui/Feedback';
import { cn } from '@/components/ui/cn';
import StudentShell from './StudentShell';

interface Dashboard {
  serverNow: string;
  entry: { entryNumber: number; teamName: string | null; isTeam: boolean; present: boolean; disqualified: boolean; members: { name: string; position: number }[] };
  round1: { status: string; startAt: string | null; endAt: string | null; assigned: number; submitted: number; submissionRef: string | null };
  round2: { status: string; startAt: string | null; endAt: string | null; finalist: boolean; state: string | null };
  results: { round1Published: boolean; finalPublished: boolean };
  announcements: { id: string; title: string | null; message: string; createdAt: string }[];
}

type StepState = 'done' | 'current' | 'upcoming' | 'skipped';

function Step({ n, title, detail, state, last }: { n: number; title: string; detail: React.ReactNode; state: StepState; last?: boolean }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0" aria-current={state === 'current' ? 'step' : undefined}>
      {!last && <span className={cn('absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px', state === 'done' ? 'bg-violet-400/50' : 'bg-line')} aria-hidden="true" />}
      <span className={cn('relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        state === 'done' ? 'bg-violet-500/25 text-violet-100' : state === 'current' ? 'bg-peb-gradient text-white shadow-glow' : 'border border-line bg-surface text-slate-500')}>
        {state === 'done' ? <Check className="h-4 w-4" aria-label="done" /> : n}
      </span>
      <div className="min-w-0 pt-1">
        <div className={cn('font-medium', state === 'upcoming' || state === 'skipped' ? 'text-slate-400' : 'text-white')}>{title}</div>
        <div className="mt-0.5 text-sm text-muted">{detail}</div>
      </div>
    </li>
  );
}

export default function StudentHome({ entryNumber }: { entryNumber: number | null }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);
  const goLogin = useCallback(() => window.location.replace('/student/login'), []);
  useHeartbeat(goLogin);

  const load = useCallback(async () => {
    try {
      const data = await api<Dashboard>('/api/student/dashboard', { loginPath: '/student/login' });
      setD(data);
      setError(null);
      if (redirected.current) return;
      const r1Open = data.round1.status === 'running' && !(data.round1.assigned > 0 && data.round1.submitted === data.round1.assigned);
      const r2Open = data.round2.finalist && data.round2.status === 'running' && data.round2.state !== 'FINAL_SUBMISSION';
      if (r1Open) { redirected.current = true; window.location.assign('/student/round1'); }
      else if (r2Open) { redirected.current = true; window.location.assign('/student/round2'); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setError(e instanceof Error ? e.message : 'Connection issue.');
      throw e;
    }
  }, []);
  usePolling(load, 4000);

  const r1 = d?.round1;
  const r2 = d?.round2;
  const r2Left = useServerCountdown({ endAtIso: r2?.status === 'running' ? r2.endAt : null, serverNowIso: d?.serverNow ?? null });
  const members = d?.entry.members.map((m) => m.name) ?? [];
  const r1Submitted = !!r1 && r1.assigned > 0 && r1.submitted === r1.assigned;

  const hero = (() => {
    if (!d || !r1 || !r2) return { title: 'Connecting…', body: 'Loading your team’s status.', icon: <Clock className="h-5 w-5" /> };
    if (d.entry.disqualified) return { title: 'Your entry is disqualified', body: 'Please speak to the registration desk.', icon: <Clock className="h-5 w-5" /> };
    if (r2.finalist && r2.status === 'paused') return { title: 'Round 2 is paused', body: 'Your work is saved and the timer is frozen.', icon: <Pause className="h-5 w-5" /> };
    if (r2.finalist && r2.status === 'running') return { title: r2.state === 'FINAL_SUBMISSION' ? 'Your final answer is in' : 'Round 2 is live', body: r2.state === 'FINAL_SUBMISSION' ? 'Stay nearby — the jury may still ask you questions.' : 'Open the final round to keep working.', icon: <Trophy className="h-5 w-5" />, href: '/student/round2', cta: 'Open Round 2' };
    if (r1.status === 'paused') return { title: 'Round 1 is paused', body: 'Your timer is frozen and your work is saved. This page continues on its own.', icon: <Pause className="h-5 w-5" /> };
    if (r1.status === 'running' && !r1Submitted) return { title: 'Round 1 is live', body: 'Opening your challenges…', icon: <ArrowRight className="h-5 w-5" />, href: '/student/round1', cta: 'Open my challenges' };
    if (r1Submitted && !d.results.round1Published) return { title: 'Your Round 1 answers are in', body: r1.submissionRef ? `Reference ${r1.submissionRef}. Results appear here once the organizers publish them.` : 'Results appear here once the organizers publish them.', icon: <Check className="h-5 w-5" /> };
    if (d.results.round1Published || d.results.finalPublished) return { title: 'Results are out', body: 'See how your team did.', icon: <Trophy className="h-5 w-5" />, href: '/student/results', cta: 'View results' };
    if (r1.status === 'not_started') return { title: 'You’re in. Waiting for the start.', body: 'Keep this page open. Your challenges open automatically the moment the organizers start Round 1.', icon: <Clock className="h-5 w-5" /> };
    return { title: 'Round 1 has ended', body: 'Results will appear here once they are published.', icon: <Check className="h-5 w-5" /> };
  })();

  const steps: { title: string; detail: React.ReactNode; state: StepState }[] = d && r1 && r2 ? [
    { title: 'Registered', detail: `${d.entry.isTeam ? 'Team' : 'Individual'} entry ${d.entry.entryNumber}`, state: 'done' },
    { title: 'Checked in', detail: d.entry.present ? 'Marked present at the desk.' : 'Visit the registration desk.', state: d.entry.present ? 'done' : 'current' },
    { title: 'Round 1 — four timed challenges', detail: r1Submitted ? `Submitted${r1.submissionRef ? ` · ${r1.submissionRef}` : ''}` : r1.status === 'running' ? `In progress · ${r1.submitted}/${r1.assigned} done` : r1.status === 'paused' ? 'Paused' : r1.status === 'ended' ? 'Closed' : 'Not started yet',
      state: r1Submitted || r1.status === 'ended' ? 'done' : r1.status === 'not_started' && !d.entry.present ? 'upcoming' : 'current' },
    { title: 'Round 1 results', detail: d.results.round1Published ? <Link href="/student/results" className="text-cyan-300 hover:text-cyan-200">Published — view results</Link> : 'Not published yet', state: d.results.round1Published ? 'done' : r1.status === 'ended' ? 'current' : 'upcoming' },
    { title: 'Round 2 — the final', detail: r2.finalist ? (r2.status === 'not_started' ? 'You’re a finalist! Waiting for the start.' : r2.status === 'ended' ? 'Completed' : r2.state === 'FINAL_SUBMISSION' ? 'Final answer submitted' : 'In progress') : d.results.round1Published ? 'Top teams only' : 'Finalists are announced after Round 1',
      state: !r2.finalist ? (d.results.round1Published ? 'skipped' : 'upcoming') : r2.status === 'ended' || r2.state === 'FINAL_SUBMISSION' ? 'done' : 'current' },
  ] : [];

  return (
    <StudentShell entryNumber={entryNumber} nav>
      {error && <Alert tone="warning" className="mb-5">{error} Retrying automatically.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <section className="peb-panel relative overflow-hidden p-6 sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl" aria-hidden="true" />
            <div className="relative">
              <div className="text-sm text-muted">Entry</div>
              <div className="font-display text-[5.5rem] font-semibold leading-[0.9] tabular text-white sm:text-[7rem]" style={{ fontVariationSettings: "'wdth' 80" }}>
                {d?.entry.entryNumber ?? entryNumber ?? '—'}
              </div>
              <div className="mt-3 text-lg text-slate-100">{d?.entry.teamName || (d ? 'Individual entry' : ' ')}</div>
              <div className="text-sm text-muted">{members.join(' & ') || ' '}</div>
            </div>
          </section>

          <section className="peb-panel p-6" aria-live="polite">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200" aria-hidden="true">{hero.icon}</span>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold text-white">{hero.title}</h1>
                <p className="mt-1 leading-7 text-slate-300">{hero.body}</p>
                {r2Left !== null && r2?.finalist && <p className="mt-2 font-display text-2xl font-semibold tabular text-white">{formatMMSS(r2Left)} <span className="text-sm font-normal text-muted">left in Round 2</span></p>}
                {'href' in hero && hero.href && <Link href={hero.href} className="peb-btn-primary mt-4">{hero.cta}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
              </div>
            </div>
          </section>

          <section className="peb-panel p-6" aria-labelledby="ann-title">
            <h2 id="ann-title" className="flex items-center gap-2 text-base font-semibold text-white"><Megaphone className="h-4 w-4 text-violet-300" aria-hidden="true" />Announcements</h2>
            {!d ? <div className="mt-4 space-y-2"><div className="peb-skeleton h-4 w-3/4" /><div className="peb-skeleton h-4 w-1/2" /></div> : d.announcements.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nothing yet. Updates from the organizers will show up here.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line/60">
                {d.announcements.map((a) => (
                  <li key={a.id} className="py-3 first:pt-1 last:pb-0">
                    {a.title && <div className="font-medium text-white">{a.title}</div>}
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{a.message}</p>
                    <div className="mt-0.5 text-xs text-faint">{timeAgo(a.createdAt, new Date(d.serverNow).getTime())}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="peb-panel self-start p-6" aria-labelledby="journey-title">
          <h2 id="journey-title" className="mb-5 text-base font-semibold text-white">Your competition</h2>
          {steps.length ? (
            <ol>{steps.map((s, i) => <Step key={s.title} n={i + 1} {...s} last={i === steps.length - 1} />)}</ol>
          ) : <div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="peb-skeleton h-10" />)}</div>}
          <p className="mt-6 border-t border-line/70 pt-4 text-xs leading-5 text-faint">Keep this tab open on one device. If you get signed out, the registration desk can release your session or issue a new PIN.</p>
        </aside>
      </div>
    </StudentShell>
  );
}
