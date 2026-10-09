'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface Stats {
  registered: number;
  present: number;
  submitted: number;
  evaluated: number;
  qualified: number;
  round1Status: string;
}

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/display/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error('Unable to refresh dashboard statistics.');
      setStats(await res.json());
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dashboard refresh failed.');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const startRound1 = async () => {
    if (!confirm('Start Round 1 now? This assigns challenges to present entries and starts the official timer.')) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/round1/start', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to start Round 1.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start Round 1.');
      await load();
    } finally {
      setStarting(false);
    }
  };

  const controlRound1 = async (action: 'pause' | 'resume') => {
    const setter = action === 'pause' ? setPausing : setResuming;
    if (!confirm(action === 'pause' ? 'Pause Round 1? Students will temporarily be unable to submit.' : 'Resume Round 1 now?')) return;
    setter(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/round1/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to ' + action + ' Round 1.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to ' + action + ' Round 1.');
      await load();
    } finally { setter(false); }
  };

  const stopRound1 = async () => {
    if (!confirm('Stop Round 1 now? Students will be returned to the waiting room and cannot continue this round. This action ends the round.')) return;
    setStopping(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/round1/stop', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to stop Round 1.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop Round 1.');
      await load();
    } finally {
      setStopping(false);
    }
  };

  const startOver = async () => {
    if (!confirm('START OVER will permanently delete Round 1 assignments, submissions, AI evaluations and manual score reviews. Registrations and attendance are kept. Continue?')) return;
    if (!confirm('Final confirmation: erase Round 1 work and return the event to Not Started?')) return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/round1/reset', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to reset Round 1.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset Round 1.');
      await load();
    } finally { setResetting(false); }
  };

  const cards: { label: string; value: number }[] = stats
    ? [
        { label: 'Registered', value: stats.registered },
        { label: 'Present', value: stats.present },
        { label: 'Submitted', value: stats.submitted },
        { label: 'Evaluated', value: stats.evaluated },
        { label: 'Qualified', value: stats.qualified },
      ]
    : [];

  const status = stats?.round1Status ?? 'loading';
  const running = status === 'running';
  const paused = status === 'paused';
  const ended = status === 'ended';
  const slots = stats ? cards : [
    { label: 'Registered', value: 0 },
    { label: 'Present', value: 0 },
    { label: 'Submitted', value: 0 },
    { label: 'Evaluated', value: 0 },
    { label: 'Qualified', value: 0 },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-300">Event control center</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-muted">Live competition overview and Round 1 controls.</p>
        </div>
        <div className="text-xs text-muted">{lastUpdated ? `Updated ${lastUpdated}` : 'Connecting to live stats…'}</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {slots.map((c) => (
          <div key={c.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-lg shadow-black/10">
            <div className="mb-3 h-1 w-10 rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" />
            <div className="text-3xl font-bold tabular-nums text-white">{stats ? c.value : '—'}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>

      <section className="mb-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-950/60 via-slate-900/80 to-cyan-950/40 p-5 shadow-2xl shadow-violet-950/20 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold">Round 1 · Prompt Arena</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${running ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : ended ? 'border-slate-400/30 bg-slate-400/10 text-slate-300' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>
                {status.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              {running ? 'Round is live. Students can work on their assigned challenges.' : paused ? 'Round is paused. Resume when you are ready.' : ended ? 'This round is closed. Start is disabled to protect submitted work.' : 'Check attendance and challenge assignments before opening the round.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="peb-btn-primary min-w-36 disabled:cursor-not-allowed disabled:opacity-50" onClick={startRound1} disabled={starting || stopping || pausing || resuming || running || paused || ended || !stats}>
              {starting ? 'Starting…' : 'Start Round 1'}
            </button>
            <button className="min-w-36 rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40" onClick={stopRound1} disabled={stopping || starting || pausing || resuming || resetting || !running}>
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
            {running && <button className="min-w-28 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 disabled:opacity-40" onClick={() => controlRound1('pause')} disabled={pausing || resuming || stopping || starting}>{pausing ? 'Pausing…' : 'Pause'}</button>}
            {ended && <button className="min-w-32 rounded-lg border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 disabled:opacity-40" onClick={startOver} disabled={resetting || starting || stopping || pausing || resuming}>{resetting ? 'Resetting…' : 'Start Over'}</button>}
            {paused && <button className="min-w-28 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-40" onClick={() => controlRound1('resume')} disabled={pausing || resuming || stopping || starting}>{resuming ? 'Resuming…' : 'Resume'}</button>}
          </div>
        </div>
        {error && <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      </section>

      <Link href="/admin/entries" className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-cyan-300/40 hover:bg-white/[0.06]">
        <div>
          <div className="font-semibold">Participant entries</div>
          <div className="mt-1 text-sm text-muted">Inspect prompts, generated outputs and evaluation scores.</div>
        </div>
        <span className="text-xl text-cyan-300 transition group-hover:translate-x-1">→</span>
      </Link>
    </div>
  );
}
