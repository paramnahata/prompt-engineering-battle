'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface EntryVM {
  id: string;
  entry_code: string;
  team_name: string | null;
  is_team: boolean;
  present: boolean;
  disqualified: boolean;
  team_members: { member_position: number; full_name: string }[];
}

export default function EntriesListClient() {
  const [entries, setEntries] = useState<EntryVM[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/participants')
      .then((r) => r.json())
      .then((body) => setEntries(body.entries ?? []))
      .finally(() => setLoading(false));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) =>
        [e.entry_code, e.team_name ?? '', ...(e.team_members?.map((m) => m.full_name) ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    : entries;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Entries</h1>
        <input
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm w-56"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="peb-card">
        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted text-sm">No entries found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-2 pr-3">Entry</th>
                <th className="py-2 pr-3">Participant / Team</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-medium">{e.entry_code}</td>
                  <td className="py-2 pr-3 text-muted">
                    {e.is_team ? (
                      <>
                        <div className="text-foreground">{e.team_name || 'Unnamed team'}</div>
                        {e.team_members
                          ?.sort((a, b) => a.member_position - b.member_position)
                          .map((m) => (
                            <div key={m.member_position} className="text-xs">{m.full_name}</div>
                          ))}
                      </>
                    ) : (
                      <span className="text-foreground">{e.team_members?.[0]?.full_name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Link href={`/admin/entries/${e.id}`} className="text-accent-cyan hover:underline text-xs">
                      View Round 1 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
