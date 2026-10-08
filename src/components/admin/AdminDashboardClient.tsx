'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

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
  const [startError, setStartError] = useState<string | null>(null);

  const load = () => fetch('/api/display/stats').then((r) => r.json()).then(setStats).catch(() => {});

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const startRound1 = async () => {
    if (!confirm('Start Round 1 now? This assigns challenges to every present entry and starts the 30-minute clock for everyone.')) {
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/admin/round1/start', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStartError(body.error ?? 'Failed to start Round 1');
        return;
      }
      load();
    } finally {
      setStarting(false);
    }
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

  const slots: { label: string; value: number | null }[] = stats
    ? cards
    : [
        { label: 'Registered', value: null },
        { label: 'Present', value: null },
        { label: 'Submitted', value: null },
        { label: 'Evaluated', value: null },
        { label: 'Qualified', value: null },
      ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {slots.map((c) => (
          <div key={c.label} className="peb-card text-center py-4">
            <div className="text-2xl font-bold text-accent-cyan">{c.value ?? '—'}</div>
            <div className="text-xs text-muted uppercase tracking-wide mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="peb-card mb-6 flex items-center justify-between">
        <div>
          <div className="font-medium">Round 1</div>
          <div className="text-sm text-muted capitalize">Status: {stats?.round1Status.replace('_', ' ') ?? '…'}</div>
          {startError && <div className="text-sm text-red-400 mt-1">{startError}</div>}
        </div>
        <button
          className="peb-btn-primary"
          onClick={startRound1}
          disabled={starting || stats?.round1Status === 'running' || stats?.round1Status === 'ended'}
        >
          {starting ? 'Starting…' : stats?.round1Status === 'running' ? 'Running' : 'Start Round 1'}
        </button>
      </div>

      <Link href="/admin/entries" className="peb-card hover:border-accent transition-colors flex items-center justify-between">
        <div>
          <div className="font-medium">Entries</div>
          <div className="text-sm text-muted">View any entry's PS, prompt, output, and scores</div>
        </div>
        <span className="text-accent-cyan text-sm">→</span>
      </Link>
    </div>
  );
}
