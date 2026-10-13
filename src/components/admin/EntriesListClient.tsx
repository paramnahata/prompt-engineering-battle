'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { matchesFilter } from '@/lib/participant-search';

interface EntryVM {
  id: string;
  entry_number: number;
  registration_id: string;
  team_name: string | null;
  is_team: boolean;
  present: boolean;
  disqualified: boolean;
  team_members: { member_position: number; full_name: string; email: string | null; phone: string | null }[];
}

export default function EntriesListClient() {
  const [entries, setEntries] = useState<EntryVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/admin/participants', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? 'Could not load entries.');
        setEntries(body.entries ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load entries.'));
  }, []);

  const filtered = useMemo(() => (entries ?? []).filter((e) => matchesFilter(e, query)), [entries, query]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Entries</h1>
        <input className="w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" placeholder="Search number, name, team…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search entries" />
      </div>
      <div className="peb-card">
        {error ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : entries === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted">No entries found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3">Entry</th><th className="py-2 pr-3">Team / participants</th><th className="py-2 pr-3">Attendance</th><th className="py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-semibold tabular-nums">{e.entry_number}</td>
                    <td className="py-2 pr-3">
                      {e.team_name && <div>{e.team_name}</div>}
                      <div className={e.team_name ? 'text-xs text-muted' : ''}>{[...e.team_members].sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name).join(', ')}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs">{e.disqualified ? <span className="text-rose-300">Disqualified</span> : e.present ? <span className="text-emerald-300">Present</span> : <span className="text-muted">Not checked in</span>}</td>
                    <td className="py-2 text-right"><Link href={`/admin/entries/${e.id}`} className="text-xs text-accent-cyan hover:underline">Round 1 detail →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
