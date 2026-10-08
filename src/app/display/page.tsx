'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import AccessCodePanel from '@/components/admin/AccessCodePanel';

interface RoundRow {
  round_number: number;
  status: string;
  round_end_at: string | null;
}
interface Announcement {
  id: string;
  message: string;
}
interface Stats {
  registered: number;
  present: number;
  submitted: number;
  evaluated: number;
  qualified: number;
  serverNow: string;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  running: 'In Progress',
  paused: 'Paused',
  ended: 'Ended',
};

export default function DisplayPage() {
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [clock, setClock] = useState('');

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/display/stats');
      const data = await res.json();
      setStats(data);
      return data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const supabase = supabaseBrowser();

    const loadRealtimeBits = async () => {
      const { data: r } = await supabase.from('rounds').select('round_number, status, round_end_at');
      if (r) setRounds(r as RoundRow[]);
      const { data: a } = await supabase.from('announcements').select('id, message').eq('active', true);
      if (a) setAnnouncements(a as Announcement[]);
    };
    loadRealtimeBits();
    fetchStats();

    const channel = supabase
      .channel('display-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, loadRealtimeBits)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, loadRealtimeBits)
      .subscribe();

    const statsInterval = setInterval(fetchStats, 8000);
    const clockInterval = setInterval(
      () => setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })),
      1000
    );

    return () => {
      supabase.removeChannel(channel);
      clearInterval(statsInterval);
      clearInterval(clockInterval);
    };
  }, []);

  const activeRound = rounds.find((r) => r.status === 'running') ?? rounds.find((r) => r.status === 'paused') ?? rounds[0];

  const secondsLeft = useServerCountdown({
    endAtIso: activeRound?.round_end_at ?? null,
    serverNowIso: stats?.serverNow ?? null,
    onResync: async () => {
      const fresh = await fetchStats();
      return fresh && activeRound?.round_end_at
        ? { endAtIso: activeRound.round_end_at, serverNowIso: fresh.serverNow }
        : null;
    },
  });

  const statCards: { label: string; value: number }[] = stats
    ? [
        { label: 'Registered', value: stats.registered },
        { label: 'Present', value: stats.present },
        { label: 'Submitted', value: stats.submitted },
        { label: 'Evaluated', value: stats.evaluated },
        { label: 'Qualified', value: stats.qualified },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-accent via-accent-blue to-accent-cyan bg-clip-text text-transparent">
            PROMPT ENGINEERING BATTLE
          </h1>
          <p className="text-muted mt-1">AI Prompt Optimization &amp; Problem-Solving Challenge</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-mono">{clock}</div>
          <div className="text-xs text-muted uppercase tracking-widest">Live</div>
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center gap-4">
        {activeRound ? (
          <>
            <div className="text-muted text-sm uppercase tracking-[0.3em]">
              Round {activeRound.round_number} — {STATUS_LABEL[activeRound.status] ?? activeRound.status}
            </div>
            {activeRound.status === 'running' && secondsLeft !== null ? (
              <div
                className={`text-[9rem] leading-none font-mono font-bold tracking-tight ${
                  secondsLeft < 60 ? 'text-red-400 animate-pulse-glow' : 'text-foreground'
                }`}
              >
                {formatMMSS(secondsLeft)}
              </div>
            ) : (
              <div className="text-5xl font-semibold text-muted">
                {activeRound.status === 'not_started' && 'Waiting to begin…'}
                {activeRound.status === 'paused' && 'Paused'}
                {activeRound.status === 'ended' && 'Round Complete'}
              </div>
            )}
          </>
        ) : (
          <div className="text-muted text-2xl">Preparing event…</div>
        )}
      </section>

      <div className="max-w-xs mx-auto w-full">
        <AccessCodePanel />
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="peb-card text-center py-6">
            <div className="text-4xl font-bold text-accent-cyan">{s.value}</div>
            <div className="text-xs text-muted uppercase tracking-widest mt-1">{s.label}</div>
          </div>
        ))}
      </section>

      <footer className="peb-card overflow-hidden">
        {announcements.length > 0 ? (
          <div className="whitespace-nowrap animate-[marquee_20s_linear_infinite] text-lg">
            {announcements.map((a) => (
              <span key={a.id} className="mx-8">
                📢 {a.message}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted text-sm">No announcements yet</div>
        )}
      </footer>

      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
