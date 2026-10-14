'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Medal, Trophy } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { api } from '@/lib/client/api';
import { Alert } from '@/components/ui/Feedback';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/components/ui/cn';
import StudentShell from './StudentShell';

type Board = { rank: number; entryNumber: number; teamName: string | null; score: number | null; you: boolean }[] | null;
interface Results {
  round1: { published: boolean; score?: number | null; maxScore?: number; rank?: number | null; totalRanked?: number; qualified?: boolean | null; hasResult?: boolean;
    challenges?: { position: number; title: string; score: number | null; maxScore: number; feedback: string | null }[]; leaderboard?: Board };
  final: { published: boolean; finalist?: boolean; round1Score?: number | null; round2Score?: number | null; finalScore?: number | null; rank?: number | null; totalRanked?: number; feedback?: string | null; leaderboard?: Board };
}

function Leaderboard({ rows, title }: { rows: NonNullable<Board>; title: string }) {
  return (
    <section className="peb-panel p-5" aria-label={title}>
      <h2 className="mb-3 font-semibold text-white">{title}</h2>
      <ol className="divide-y divide-line/60">
        {rows.map((r) => (
          <li key={`${r.rank}-${r.entryNumber}`} className={cn('flex items-center gap-3 py-2.5', r.you && 'rounded-lg bg-violet-500/10 px-2')}>
            <span className={cn('w-8 font-display text-lg font-semibold tabular', r.rank <= 3 ? 'text-white' : 'text-slate-400')}>{r.rank}</span>
            <span className="min-w-0 flex-1 truncate text-slate-200">#{r.entryNumber} {r.teamName ?? ''}{r.you && <Badge tone="violet" className="ml-2">You</Badge>}</span>
            {r.score !== null && <span className="tabular text-slate-200">{Number(r.score).toFixed(1)}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function StudentResults({ entryNumber }: { entryNumber: number | null }) {
  const [r, setR] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  useHeartbeat(useCallback(() => window.location.replace('/student/login'), []));
  const load = useCallback(async () => {
    try { setR(await api<Results>('/api/student/results', { loginPath: '/student/login' })); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load results.'); throw e; }
  }, []);
  usePolling(load, 15_000);
  const r1 = r?.round1;
  const fin = r?.final;
  return (
    <StudentShell entryNumber={entryNumber} nav>
      <h1 className="text-[2rem] font-semibold text-white">Results</h1>
      <p className="mt-1 text-muted">Only what the organizers have published is shown here.</p>
      {error && <Alert tone="warning" className="mt-4">{error}</Alert>}
      {!r ? <div className="mt-6 space-y-3"><div className="peb-skeleton h-32" /><div className="peb-skeleton h-48" /></div> : (
        <div className="mt-6 space-y-6">
          {fin?.published && (
            <section className="peb-panel relative overflow-hidden p-6">
              <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" aria-hidden="true" />
              <div className="relative flex flex-wrap items-end justify-between gap-6">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted"><Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" />Final standings</div>
                  {fin.finalist ? <>
                    {fin.rank != null && fin.rank <= 3 && (
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300/50 bg-amber-400/10 px-3 py-1 text-sm font-semibold text-amber-100">
                        <Trophy className="h-4 w-4" aria-hidden="true" />{fin.rank === 1 ? 'Winner — 1st place' : fin.rank === 2 ? 'Runner-up — 2nd place' : '3rd place'}
                      </div>
                    )}
                    {fin.rank != null && <div className="mt-1 font-display text-7xl font-semibold leading-none tabular text-white">#{fin.rank}<span className="ml-2 text-xl font-normal text-muted">of {fin.totalRanked}</span></div>}
                    {fin.finalScore != null && <p className="mt-3 text-slate-200">Final score <span className="font-semibold text-white tabular">{Number(fin.finalScore).toFixed(1)}</span> · Round 1 {Number(fin.round1Score).toFixed(1)} · Round 2 {Number(fin.round2Score).toFixed(1)}</p>}
                  </> : <p className="mt-2 text-slate-200">Final results are out. Your team competed in Round 1 only.</p>}
                </div>
              </div>
              {fin.feedback && <p className="relative mt-4 border-t border-line/70 pt-4 text-sm text-slate-300">{fin.feedback}</p>}
            </section>
          )}
          {fin?.published && fin.leaderboard && fin.leaderboard.length > 0 && <Leaderboard rows={fin.leaderboard} title="Final leaderboard" />}

          {r1?.published ? (
            <section className="peb-panel p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted"><Medal className="h-4 w-4 text-violet-300" aria-hidden="true" />Round 1</div>
                  {!r1.hasResult ? <p className="mt-2 text-slate-200">Your entry has no Round 1 result.</p> : <>
                    {r1.score != null && <div className="mt-1 font-display text-6xl font-semibold leading-none tabular text-white">{Number(r1.score).toFixed(1)}<span className="ml-2 text-xl font-normal text-muted">/ {r1.maxScore}</span></div>}
                    {r1.rank != null && <p className="mt-2 text-slate-200">Rank <span className="font-semibold text-white">{r1.rank}</span> of {r1.totalRanked}</p>}
                  </>}
                </div>
                {r1.qualified != null && r1.hasResult && <Badge tone={r1.qualified ? 'green' : 'neutral'} className="text-sm">{r1.qualified ? 'Qualified for Round 2' : 'Not in the final'}</Badge>}
              </div>
              {r1.challenges && r1.challenges.length > 0 && (r1.challenges.some((c) => c.score !== null || c.feedback)) && (
                <ol className="mt-5 divide-y divide-line/60 border-t border-line/70">
                  {r1.challenges.map((c) => (
                    <li key={c.position} className="py-3">
                      <div className="flex items-baseline justify-between gap-3"><span className="text-slate-100">{c.position}. {c.title}</span>{c.score !== null && <span className="tabular text-white">{Number(c.score).toFixed(1)} <span className="text-xs text-muted">/ {c.maxScore}</span></span>}</div>
                      {c.feedback && <p className="mt-1 text-sm text-muted">{c.feedback}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : (
            <section className="peb-panel p-8 text-center">
              <h2 className="text-xl font-semibold text-white">Round 1 results aren’t out yet</h2>
              <p className="mx-auto mt-2 max-w-md text-muted">The organizers publish results after every answer is evaluated. This page updates on its own.</p>
              <Link href="/student/waiting" className="peb-btn-secondary mt-5">Back to my dashboard</Link>
            </section>
          )}
          {r1?.published && r1.leaderboard && r1.leaderboard.length > 0 && <Leaderboard rows={r1.leaderboard} title="Round 1 leaderboard" />}
        </div>
      )}
    </StudentShell>
  );
}
