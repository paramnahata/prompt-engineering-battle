'use client';

import { useCallback, useEffect, useState } from 'react';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { usePolling } from '@/hooks/usePolling';
import { formatMMSS } from '@/lib/timer';
import AccessCodePanel from '@/components/admin/AccessCodePanel';

interface DisplayData {
  registered: number;
  present: number;
  submitted: number;
  round: { round_number: number; status: string; round_end_at: string | null } | null;
  announcements: { id: string; message: string }[];
  serverNow: string;
}

const STATUS_LABEL: Record<string, string> = { not_started: 'Not started', running: 'In progress', paused: 'Paused', ended: 'Ended' };

export default function DisplayScreen() {
  const [data, setData] = useState<DisplayData | null>(null);
  const [clock, setClock] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/display/stats', { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/organizer/login?next=/display');
      return;
    }
    if (!res.ok) throw new Error('stats');
    setData(await res.json());
  }, []);
  usePolling(load, 5000, { pauseWhenHidden: false });

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => clearInterval(t);
  }, []);

  const round = data?.round;
  const secondsLeft = useServerCountdown({
    endAtIso: round?.status === 'running' ? round.round_end_at : null,
    serverNowIso: data?.serverNow ?? null,
  });

  return (
    <div className="flex min-h-screen flex-col gap-8 bg-background p-8 text-foreground">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="bg-gradient-to-r from-accent via-accent-blue to-accent-cyan bg-clip-text text-4xl font-bold tracking-tight text-transparent">PROMPT ENGINEERING BATTLE</h1>
          <p className="mt-1 text-muted">AI Prompt Optimization &amp; Problem-Solving Challenge</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl">{clock}</div>
          <div className="text-xs uppercase tracking-widest text-muted">Live</div>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-4">
        {round ? (
          <>
            <div className="text-sm uppercase tracking-[0.3em] text-muted">Round {round.round_number} — {STATUS_LABEL[round.status] ?? round.status}</div>
            {round.status === 'running' && secondsLeft !== null ? (
              <div className={`font-mono text-[8rem] font-bold leading-none tracking-tight sm:text-[9rem] ${secondsLeft < 60 ? 'animate-pulse-glow text-red-400' : ''}`}>{formatMMSS(secondsLeft)}</div>
            ) : (
              <div className="text-5xl font-semibold text-muted">
                {round.status === 'not_started' && 'Waiting to begin…'}
                {round.status === 'paused' && 'Paused'}
                {round.status === 'ended' && 'Round complete'}
              </div>
            )}
          </>
        ) : (
          <div className="text-2xl text-muted">Preparing event…</div>
        )}
      </section>

      <div className="mx-auto w-full max-w-md"><AccessCodePanel large /></div>

      <section className="grid grid-cols-3 gap-4">
        {[['Registered', data?.registered], ['Checked in', data?.present], ['Answers submitted', data?.submitted]].map(([label, value]) => (
          <div key={label as string} className="peb-card py-6 text-center">
            <div className="text-4xl font-bold text-accent-cyan">{value ?? '—'}</div>
            <div className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</div>
          </div>
        ))}
      </section>

      <footer className="peb-card overflow-hidden text-center text-lg">
        {data?.announcements.length ? `📢 ${data.announcements[0]?.message}` : <span className="text-sm text-muted">No announcements</span>}
      </footer>
    </div>
  );
}
