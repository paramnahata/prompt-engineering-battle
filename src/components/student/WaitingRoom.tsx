'use client';

import { useCallback, useState } from 'react';
import LogoutButton from '@/components/auth/LogoutButton';
import { usePolling } from '@/hooks/usePolling';
import { useHeartbeat } from '@/hooks/useHeartbeat';

type RoundStatus = 'not_started' | 'running' | 'paused' | 'ended';

export default function WaitingRoom({ entryNumber }: { entryNumber: number | null }) {
  const [status, setStatus] = useState<RoundStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionEnded = useCallback(() => window.location.replace('/student/login'), []);
  useHeartbeat(sessionEnded);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/student/waiting/state', { cache: 'no-store' });
      if (res.status === 401) return sessionEnded();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not refresh round status.');
      setStatus(data.status);
      setError(null);
      if (data.status === 'running') window.location.replace('/student/round1');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection issue.');
      throw e;
    }
  }, [sessionEnded]);

  usePolling(check, 4000);

  const ended = status === 'ended';
  const paused = status === 'paused';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-violet-600/20 blur-[100px]" />
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {entryNumber !== null && <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200">Entry {entryNumber}</span>}
        <LogoutButton redirectTo="/student/login" />
      </div>
      <section className="relative w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/70 p-8 text-center shadow-2xl shadow-violet-950/30 backdrop-blur-xl sm:p-12">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-violet-500/20 to-cyan-500/10 text-2xl" aria-hidden="true">
          {ended ? '✓' : paused ? 'Ⅱ' : '⚡'}
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300">Prompt Engineering Battle</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          {status === null ? 'Connecting…' : ended ? 'Round 1 is closed' : paused ? 'Round paused' : 'You’re in the arena'}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-slate-400" aria-live="polite">
          {ended
            ? 'Round 1 has ended and your answers have been submitted. Please wait for instructions about results.'
            : paused
              ? 'The organizer paused the round. Your timer is frozen and your work is saved. This page continues automatically when the round resumes.'
              : 'You are signed in. Your challenges will open automatically as soon as the organizer starts Round 1 — keep this page open.'}
        </p>
        {!ended && (
          <div className="mx-auto mt-8 flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-300">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" /></span>
            Live status
          </div>
        )}
        {error && <p role="status" className="mt-5 text-xs text-amber-300">{error} Retrying automatically.</p>}
      </section>
    </main>
  );
}
