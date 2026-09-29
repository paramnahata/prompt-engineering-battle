'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Stats {
  registered: number;
  present: number;
  submitted: number;
  evaluated: number;
  qualified: number;
}

const TILES = [
  { href: '/admin/attendance', label: 'Registration Desk', desc: 'CSV import, check-in, participant table' },
  { href: '/admin/users', label: 'Accounts', desc: 'Create/reset/remove Admin, Judge, Desk logins' },
  { href: '/display', label: 'Projector / Display', desc: 'Open on the projector screen' },
];

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () => fetch('/api/display/stats').then((r) => r.json()).then(setStats).catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {slots.map((c) => (
          <div key={c.label} className="peb-card text-center py-4">
            <div className="text-2xl font-bold text-accent-cyan">{c.value ?? '—'}</div>
            <div className="text-xs text-muted uppercase tracking-wide mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="peb-card hover:border-accent transition-colors">
            <div className="font-medium">{t.label}</div>
            <div className="text-sm text-muted">{t.desc}</div>
          </Link>
        ))}
      </div>

      <p className="text-xs text-muted mt-8">
        Round controls, live per-participant monitoring, and the results/qualification review screens are the next
        build phase.
      </p>
    </div>
  );
}
