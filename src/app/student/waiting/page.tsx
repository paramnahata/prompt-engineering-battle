'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type RoundStatus = 'not_started' | 'running' | 'paused' | 'ended' | string;

export default function WaitingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<RoundStatus>('not_started');
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/student/waiting/state', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.replace('/student/login');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not refresh round status.');
      setStatus(data.status ?? 'not_started');
      setError(null);
      if (data.status === 'running') router.replace('/student/round1');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection issue. Retrying automatically…');
    }
  }, [router]);

  useEffect(() => {
    void checkStatus();
    const id = setInterval(() => { void checkStatus(); }, 3000);
    return () => clearInterval(id);
  }, [checkStatus]);

  const ended = status === 'ended';
  const paused = status === 'paused';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-violet-600/20 blur-[100px]" />
      <section className="relative w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/70 p-8 text-center shadow-2xl shadow-violet-950/30 backdrop-blur-xl sm:p-12">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-violet-500/20 to-cyan-500/10 text-2xl">
          {ended ? '✓' : paused ? 'Ⅱ' : '⚡'}
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300">Prompt Engineering Battle</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          {ended ? 'Round 1 is closed' : paused ? 'Round paused' : 'You’re in the arena'}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-slate-400">
          {ended
            ? 'The organizer has ended Round 1. Please wait for instructions about results and the next stage.'
            : paused
              ? 'The round is paused. Stay on this page; your status will update automatically when the organizer resumes or ends the round.'
              : 'You are signed in successfully. Your challenge arena will open automatically as soon as the organizer starts Round 1.'}
        </p>
        {!ended && <div className="mx-auto mt-8 flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-300">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" /></span>
          Live status check · every 3 seconds
        </div>}
        {error && <p role="status" className="mt-5 text-xs text-amber-300">{error} Retrying automatically.</p>}
        <button className="peb-btn-secondary mt-7 w-full" onClick={() => router.replace('/student/login')}>Back to student login</button>
      </section>
    </main>
  );
}
