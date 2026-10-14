'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Search, Users } from 'lucide-react';
import { matchesFilter } from '@/lib/participant-search';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { PageHeader, Panel, Stat } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';

interface EntryVM {
  id: string; entry_number: number; registration_id: string; team_name: string | null; is_team: boolean; present: boolean; disqualified: boolean; pin_set_at?: string | null;
  team_members: { member_position: number; full_name: string; email: string | null; phone: string | null; college?: string | null }[];
}
type Filter = 'all' | 'present' | 'absent' | 'no_pin' | 'disqualified';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'present', label: 'Checked in' }, { value: 'absent', label: 'Not checked in' },
  { value: 'no_pin', label: 'No PIN' }, { value: 'disqualified', label: 'Disqualified' },
];
const PAGE = 50;

export default function EntriesListClient() {
  const [entries, setEntries] = useState<EntryVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try { setEntries((await api<{ entries: EntryVM[] }>('/api/admin/participants', { loginPath: organizerLogin('/admin/entries') })).entries ?? []); }
    catch (e) { setError(errorMessage(e, 'Could not load entries.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(0), [query, filter]);

  const filtered = useMemo(() => (entries ?? []).filter((e) => {
    if (filter === 'present' && !e.present) return false;
    if (filter === 'absent' && e.present) return false;
    if (filter === 'no_pin' && e.pin_set_at) return false;
    if (filter === 'disqualified' && !e.disqualified) return false;
    return matchesFilter(e, query);
  }), [entries, query, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const all = entries ?? [];

  return (
    <div>
      <PageHeader title="Participants" description="Every registered team. Open a team to see its Round 1 prompts, outputs, AI scores and overrides."
        actions={<>
          <a href="/api/admin/export?type=participants" download className="peb-btn-secondary"><Download className="h-4 w-4" aria-hidden="true" />Export CSV</a>
          <Link href="/admin/attendance" className="peb-btn-secondary">Registration desk</Link>
        </>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Teams" value={entries ? all.length : undefined} hint={entries ? `${all.reduce((a, e) => a + e.team_members.length, 0)} participants` : undefined} />
        <Stat label="Checked in" value={entries ? all.filter((e) => e.present).length : undefined} />
        <Stat label="Without PIN" value={entries ? all.filter((e) => !e.pin_set_at).length : undefined} tone={entries && all.some((e) => !e.pin_set_at && e.present) ? 'warn' : 'default'} />
        <Stat label="Disqualified" value={entries ? all.filter((e) => e.disqualified).length : undefined} />
      </div>
      {error && <Alert tone="error" className="mb-5">{error}</Alert>}
      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-line/70 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input className="peb-input pl-9" placeholder="Search by entry number, name, team, email or phone" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search participants" />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}
                className={`rounded-md px-3 py-1.5 text-sm ${filter === f.value ? 'bg-violet-500/20 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>{f.label}</button>
            ))}
          </div>
        </div>
        {entries === null ? <div className="p-5"><SkeletonRows rows={6} /></div> : filtered.length === 0 ? (
          <div className="p-5"><EmptyState icon={<Users className="h-6 w-6" />} title={all.length ? 'No teams match' : 'No participants yet'}
            action={!all.length ? <Link href="/admin/attendance" className="peb-btn-primary">Import participants</Link> : undefined}>
            {all.length ? 'Try a different search or filter.' : 'Import the registration CSV from the registration desk.'}</EmptyState></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="peb-table min-w-[720px]">
                <thead><tr><th>Entry</th><th>Team / participants</th><th>Contact</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {rows.map((e) => {
                    const members = [...e.team_members].sort((a, b) => a.member_position - b.member_position);
                    return (
                      <tr key={e.id}>
                        <td className="font-display text-base font-semibold tabular text-white">{e.entry_number}</td>
                        <td>{e.team_name && <div className="text-slate-100">{e.team_name}</div>}<div className={e.team_name ? 'text-xs text-muted' : 'text-slate-100'}>{members.map((m) => m.full_name).join(', ')}</div></td>
                        <td className="text-xs text-muted">{members[0]?.email}<div>{members[0]?.phone}</div></td>
                        <td className="space-x-1 whitespace-nowrap">
                          {e.disqualified ? <Badge tone="red">Disqualified</Badge> : e.present ? <Badge tone="green">Checked in</Badge> : <Badge>Not checked in</Badge>}
                          {!e.pin_set_at && <Badge tone="amber">No PIN</Badge>}
                        </td>
                        <td className="text-right"><Link href={`/admin/entries/${e.id}`} className="text-sm text-cyan-300 hover:text-cyan-200">Open</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line/70 px-4 py-3 text-sm text-muted">
              <span>{filtered.length} team{filtered.length === 1 ? '' : 's'} · page {page + 1} of {pages}</span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
