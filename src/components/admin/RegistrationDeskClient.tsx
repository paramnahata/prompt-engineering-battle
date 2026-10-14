'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CsvImportPanel from './CsvImportPanel';
import { EntryEditor, PinSlips, type IssuedPin } from './DeskTools';
import { usePolling } from '@/hooks/usePolling';
import { matchesFilter, searchParticipants } from '@/lib/participant-search';

export interface TeamMember {
  member_position: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  college: string | null;
  city: string | null;
  branch: string | null;
  study_year: string | null;
}
export interface EntryVM {
  id: string;
  entry_number: number;
  registration_id: string;
  team_name: string | null;
  is_team: boolean;
  present: boolean;
  present_at: string | null;
  disqualified: boolean;
  disqualified_reason: string | null;
  pin_set_at: string | null;
  team_members: TeamMember[];
}

const sortedMembers = (e: EntryVM) => [...(e.team_members ?? [])].sort((a, b) => a.member_position - b.member_position);
const displayName = (e: EntryVM) => e.team_name || sortedMembers(e).map((m) => m.full_name).join(', ') || 'Participant';

export default function RegistrationDeskClient({ canImport = false }: { canImport?: boolean }) {
  const [entries, setEntries] = useState<EntryVM[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/participants', { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/organizer/login?next=/admin/attendance');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadError(body.error ?? 'Could not load participants.');
      throw new Error('load');
    }
    setEntries(body.entries ?? []);
    setLoadError(null);
  }, []);
  usePolling(load, 30_000);

  const setPresent = useCallback(async (entry: EntryVM, present: boolean) => {
    if (pending.has(entry.id)) return;
    setPending((p) => new Set(p).add(entry.id));
    setEntries((prev) => prev?.map((e) => (e.id === entry.id ? { ...e, present } : e)) ?? prev);
    try {
      const res = await fetch('/api/admin/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: entry.id, present }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not update attendance.');
      setToast(`Entry ${entry.entry_number} marked ${present ? 'PRESENT' : 'ABSENT'}.`);
    } catch (e) {
      setEntries((prev) => prev?.map((x) => (x.id === entry.id ? { ...x, present: !present } : x)) ?? prev);
      setToast(e instanceof Error ? e.message : 'Could not update attendance.');
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(entry.id);
        return next;
      });
    }
  }, [pending]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const presentCount = entries?.filter((e) => e.present).length ?? 0;
  const withoutPin = entries?.filter((e) => !e.pin_set_at).length ?? 0;
  const [issued, setIssued] = useState<IssuedPin[] | null>(null);
  const [editing, setEditing] = useState<EntryVM | 'new' | null>(null);
  const [issuing, setIssuing] = useState(false);

  const issuePins = async (entry?: EntryVM) => {
    const msg = entry
      ? `Issue a NEW PIN for entry ${entry.entry_number}? ${entry.pin_set_at ? 'The old PIN stops working and the team is signed out.' : ''}`
      : `Generate PINs for the ${withoutPin} entr${withoutPin === 1 ? 'y' : 'ies'} without one? They are shown once — print or download them before closing.`;
    if (!window.confirm(msg)) return;
    setIssuing(true);
    try {
      const res = await fetch('/api/admin/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify(entry ? { action: 'reissue', entryId: entry.id } : { action: 'issue_missing' }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not issue PINs.');
      setIssued(body.issued ?? []);
      void load().catch(() => {});
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not issue PINs.');
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Registration Desk</h1>
          <p className="text-sm text-muted">Search, check in, and manage participants.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {entries && <p className="text-sm text-slate-300"><span className="font-semibold text-emerald-300">{presentCount}</span> of {entries.length} checked in · <span className={withoutPin ? 'text-amber-200' : ''}>{withoutPin} without PIN</span></p>}
          {canImport && <button className="peb-btn-secondary py-2" disabled={issuing || withoutPin === 0} onClick={() => void issuePins()}>{issuing ? 'Generating…' : 'Generate missing PINs'}</button>}
          {canImport && <button className="peb-btn-secondary py-2" onClick={() => setEditing('new')}>Add entry</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <CheckInPanel entries={entries} pending={pending} onSetPresent={setPresent} onIssuePin={(e) => void issuePins(e)} onEdit={canImport ? (e) => setEditing(e) : undefined} issuing={issuing} />
      </div>

      {canImport && <CsvImportPanel onImported={() => void load().catch(() => {})} />}

      {loadError && <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200" role="alert">{loadError} <button className="underline" onClick={() => void load().catch(() => {})}>Retry</button></p>}

      <ParticipantsTable entries={entries} pending={pending} onSetPresent={setPresent} canReset={canImport} onReset={() => void load().catch(() => {})} />

      {issued && <PinSlips pins={issued} onClose={() => setIssued(null)} />}
      {editing && <EntryEditor entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); setToast(msg); void load().catch(() => {}); }} />}

      {toast && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm shadow-2xl" role="status">{toast}</div>}
    </div>
  );
}

function CheckInPanel({ entries, pending, onSetPresent, onIssuePin, onEdit, issuing }: {
  entries: EntryVM[] | null; pending: Set<string>; onSetPresent: (e: EntryVM, p: boolean) => void;
  onIssuePin: (e: EntryVM) => void; onEdit?: (e: EntryVM) => void; issuing: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [releaseMsg, setReleaseMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchParticipants(entries ?? [], query, 8), [entries, query]);
  const selected = entries?.find((e) => e.id === selectedId) ?? null;

  useEffect(() => setHighlight(0), [query]);

  const choose = (e: EntryVM) => {
    setSelectedId(e.id);
    setQuery('');
    setReleaseMsg(null);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    if (ev.key === 'Enter') { ev.preventDefault(); const r = results[highlight]; if (r) choose(r); }
    if (ev.key === 'Escape') setQuery('');
  };

  const release = async (e: EntryVM) => {
    if (!window.confirm(`Sign entry ${e.entry_number} out on all devices so they can sign in on a new one?`)) return;
    const res = await fetch('/api/admin/sessions/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: e.id }) });
    setReleaseMsg(res.ok ? 'Released. The team can sign in again now.' : 'Could not release the session.');
  };

  return (
    <div className="peb-card">
      <h2 className="mb-1 font-medium">Quick check-in</h2>
      <p className="mb-3 text-sm text-muted">Type an entry number, name, team, email or phone — results appear as you type.</p>
      <div className="relative">
        <input
          ref={inputRef}
          className="w-full rounded-xl border border-border bg-surface p-3 text-base focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder={entries ? 'e.g. 12, Priya, Team Nova, 98765…' : 'Loading participants…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="desk-suggestions"
          aria-activedescendant={results[highlight] ? `sugg-${results[highlight].id}` : undefined}
          aria-label="Search participants"
          disabled={!entries}
        />
        {query.trim() && (
          <div id="desk-suggestions" role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-white/10 bg-slate-950 shadow-2xl">
            {results.length === 0 ? (
              <p className="p-3 text-sm text-muted">No participant matches “{query.trim()}”.</p>
            ) : results.map((e, i) => (
              <button
                key={e.id}
                id={`sugg-${e.id}`}
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(e)}
                className={`flex w-full items-center justify-between gap-3 border-b border-white/5 px-3 py-2.5 text-left text-sm last:border-0 ${i === highlight ? 'bg-white/10' : ''}`}
              >
                <span className="min-w-0">
                  <span className="mr-2 inline-block min-w-8 rounded-md bg-white/10 px-1.5 py-0.5 text-center font-semibold tabular-nums">{e.entry_number}</span>
                  <span className="font-medium">{displayName(e)}</span>
                  {e.team_name && <span className="block truncate pl-11 text-xs text-muted">{sortedMembers(e).map((m) => m.full_name).join(', ')}</span>}
                </span>
                <span className={`shrink-0 text-xs ${e.present ? 'text-emerald-300' : 'text-amber-300'}`}>{e.present ? 'Present' : 'Not in'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-muted">Entry</div>
              <div className="text-3xl font-bold tabular-nums">{selected.entry_number}</div>
              <div className="text-sm">{selected.team_name || (selected.is_team ? 'Unnamed team' : 'Individual')}</div>
              <div className="text-xs text-muted">Reg. ID {selected.registration_id}</div>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${selected.disqualified ? 'bg-rose-500/20 text-rose-300' : selected.present ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-300'}`}>
              {selected.disqualified ? 'DISQUALIFIED' : selected.present ? 'PRESENT' : 'NOT CHECKED IN'}
            </span>
          </div>
          <MemberList members={sortedMembers(selected)} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-2 text-sm">
            <span>Team PIN: {selected.pin_set_at ? <span className="text-emerald-300">issued {new Date(selected.pin_set_at).toLocaleString()}</span> : <span className="text-amber-200">not issued</span>}</span>
            <span className="flex gap-2">
              <button className="rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40" disabled={issuing} onClick={() => onIssuePin(selected)}>{selected.pin_set_at ? 'Issue new PIN' : 'Issue PIN'}</button>
              {onEdit && <button className="rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/5" onClick={() => onEdit(selected)}>Edit entry</button>}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="peb-btn-primary flex-1" onClick={() => onSetPresent(selected, true)} disabled={pending.has(selected.id) || selected.present}>Mark present</button>
            <button className="peb-btn-secondary flex-1" onClick={() => onSetPresent(selected, false)} disabled={pending.has(selected.id) || !selected.present}>Mark absent</button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
            <span>Students sign in with entry number <b className="text-white">{selected.entry_number}</b>, and their team PIN. One device per entry.</span>
            <button className="shrink-0 underline hover:text-white" onClick={() => void release(selected)}>Release device</button>
          </div>
          {releaseMsg && <p className="mt-2 text-xs text-cyan-200" role="status">{releaseMsg}</p>}
          <button className="mt-3 text-xs text-slate-400 underline" onClick={() => { setSelectedId(null); inputRef.current?.focus(); }}>Search another</button>
        </div>
      )}
    </div>
  );
}

function MemberList({ members }: { members: TeamMember[] }) {
  if (!members.length) return <p className="text-sm text-muted">No members recorded.</p>;
  return (
    <ul className="space-y-2">
      {members.map((m) => (
        <li key={m.member_position} className="rounded-lg border border-white/5 bg-black/20 p-2 text-sm">
          <div className="font-medium">{m.full_name}{members.length > 1 && <span className="ml-2 text-xs text-muted">Member {m.member_position}</span>}</div>
          <div className="mt-0.5 grid gap-x-4 text-xs text-muted sm:grid-cols-2">
            <span>{m.email || <i>No email provided</i>}</span>
            <span>{m.phone || <i>No phone provided</i>}</span>
            {(m.college || m.branch || m.study_year) && <span className="sm:col-span-2">{[m.college, m.branch, m.study_year && `Year ${m.study_year}`].filter(Boolean).join(' · ')}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ParticipantsTable({ entries, pending, onSetPresent, canReset, onReset }: {
  entries: EntryVM[] | null; pending: Set<string>; onSetPresent: (e: EntryVM, p: boolean) => void; canReset: boolean; onReset: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<'all' | 'present' | 'absent'>('all');
  const [resetError, setResetError] = useState<string | null>(null);

  const rows = useMemo(() => (entries ?? []).filter((e) =>
    (status === 'all' || (status === 'present') === e.present) && matchesFilter(e, filter)), [entries, filter, status]);


  const resetAll = async () => {
    const typed = window.prompt(`This deletes ALL ${entries?.length ?? 0} participants (allowed only before Round 1 starts). Type DELETE ALL PARTICIPANTS to confirm.`);
    if (typed !== 'DELETE ALL PARTICIPANTS') return;
    setResetError(null);
    const res = await fetch('/api/admin/participants', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: typed }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setResetError(body.error ?? 'Could not clear participants.');
    onReset();
  };

  return (
    <div className="peb-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">All participants ({rows.length}{entries && rows.length !== entries.length ? ` of ${entries.length}` : ''})</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input className="w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter participants" />
          <select className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Attendance filter">
            <option value="all">All</option><option value="present">Present</option><option value="absent">Not checked in</option>
          </select>
          {canReset && <button className="text-xs text-red-400 hover:text-red-300" onClick={() => void resetAll()}>Delete all…</button>}
        </div>
      </div>
      {resetError && <p className="mb-3 text-sm text-red-400" role="alert">{resetError}</p>}
      {entries === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No participants imported yet.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No participants match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="w-16 py-2 pr-3">Entry</th><th className="py-2 pr-3">Team</th><th className="py-2 pr-3">Member</th>
                <th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Phone</th><th className="py-2 pr-3">College / branch</th><th className="py-2 pr-3">PIN</th><th className="py-2">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const members = sortedMembers(e);
                // Teams have at most 2 members, so every member is always shown.
                const visible = members.length ? members : [{ member_position: 0, full_name: '—', email: null, phone: null, gender: null, college: null, city: null, branch: null, study_year: null }];
                return visible.map((m, i) => (
                  <tr key={`${e.id}-${m.member_position}`} className={`align-top ${i === visible.length - 1 ? 'border-b border-border/60' : ''}`}>
                    {i === 0 && (
                      <>
                        <td className="py-2.5 pr-3 font-semibold tabular-nums" rowSpan={visible.length}>{e.entry_number}</td>
                        <td className="py-2.5 pr-3" rowSpan={visible.length}>
                          {e.team_name || (e.is_team ? <i className="text-muted">Unnamed team</i> : <span className="text-muted">Individual</span>)}
                        </td>
                      </>
                    )}
                    <td className="py-2.5 pr-3">{m.full_name}</td>
                    <td className="break-all py-2.5 pr-3 text-xs text-muted">{m.email || <i>—</i>}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-muted">{m.phone || <i>—</i>}</td>
                    <td className="py-2.5 pr-3 text-xs text-muted">{[m.college, m.branch].filter(Boolean).join(' · ') || '—'}</td>
                    {i === 0 && <td className="py-2.5 pr-3 text-xs" rowSpan={visible.length}>{e.pin_set_at ? <span className="text-emerald-300">Issued</span> : <span className="text-amber-200">—</span>}</td>}
                    {i === 0 && (
                      <td className="whitespace-nowrap py-2.5" rowSpan={visible.length}>
                        <button
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${e.present ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-300'}`}
                          onClick={() => onSetPresent(e, !e.present)}
                          disabled={pending.has(e.id)}
                          title={e.present ? 'Click to mark absent' : 'Click to mark present'}
                        >
                          {e.present ? 'Present ✓' : 'Check in'}
                        </button>
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
