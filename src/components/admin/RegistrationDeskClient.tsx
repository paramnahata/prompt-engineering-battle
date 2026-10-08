'use client';

import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import AccessCodePanel from './AccessCodePanel';

interface TeamMember {
  member_position: number;
  full_name: string;
}
interface EntryVM {
  id: string;
  entry_code: string;
  team_name: string | null;
  is_team: boolean;
  payment_status: string;
  present: boolean;
  disqualified: boolean;
  team_members: TeamMember[];
}

const REQUIRED_FIELDS = ['registration_id', 'member1_name'] as const;
const OPTIONAL_FIELDS = ['team_name', 'member1_email', 'member2_name', 'member2_email'] as const;
// payment_status isn't collected — every entry is treated as already paid.
type MappingKey = (typeof REQUIRED_FIELDS)[number] | (typeof OPTIONAL_FIELDS)[number];

function LookupPanel() {
  const [entryCode, setEntryCode] = useState('');
  const [entry, setEntry] = useState<EntryVM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEntry(null);
    setLastAction(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/attendance?entryCode=${encodeURIComponent(entryCode.trim())}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Lookup failed');
        return;
      }
      setEntry(body.entry);
    } finally {
      setLoading(false);
    }
  };

  const markPresent = async (present: boolean) => {
    if (!entry) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: entry.id, present }),
      });
      if (res.ok) {
        setEntry({ ...entry, present });
        setLastAction(present ? 'Marked PRESENT' : 'Marked ABSENT');
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to update');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="peb-card">
      <h2 className="font-medium mb-1">Quick check-in</h2>
      <p className="text-muted text-sm mb-4">Scan or type an Entry ID.</p>
      <form onSubmit={lookup} className="flex gap-2 mb-4">
        <input
          className="flex-1 bg-surface border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="ENTRY-001"
          value={entryCode}
          onChange={(e) => setEntryCode(e.target.value)}
          suppressHydrationWarning
        />
        <button className="peb-btn-primary" disabled={loading}>
          {loading ? '…' : 'Find'}
        </button>
      </form>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {entry && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold text-lg">{entry.entry_code}</div>
              <div className="text-sm text-muted">
                {entry.is_team ? entry.team_name || 'Unnamed team' : entry.team_members?.[0]?.full_name}
              </div>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                entry.present ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
              }`}
            >
              {entry.present ? 'PRESENT' : 'NOT CHECKED IN'}
            </span>
          </div>
          {entry.is_team && (
            <ul className="text-sm text-muted mb-4 space-y-1">
              {entry.team_members
                ?.sort((a, b) => a.member_position - b.member_position)
                .map((m) => (
                  <li key={m.member_position}>
                    Member {m.member_position}: {m.full_name}
                  </li>
                ))}
            </ul>
          )}
          <p className="text-xs text-muted mb-4">
            {entry.is_team
              ? 'Either team member can log in with this Entry ID — only one needs to.'
              : 'Single participant — logs in with this Entry ID.'}
          </p>
          <div className="flex gap-2">
            <button className="peb-btn-primary flex-1" onClick={() => markPresent(true)} disabled={loading}>
              Mark Present
            </button>
            <button className="peb-btn-secondary flex-1" onClick={() => markPresent(false)} disabled={loading}>
              Mark Absent
            </button>
          </div>
          {lastAction && <p className="text-xs text-accent-cyan mt-3">{lastAction}</p>}
        </div>
      )}
    </div>
  );
}

function CsvImportPanel({ onImported }: { onImported: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<MappingKey, string>>>({});
  const [preview, setPreview] = useState<any>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const onFile = (file: File) => {
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      setCsvText(text);
      const parsed = Papa.parse(text, { header: true, preview: 1 });
      setHeaders(parsed.meta.fields ?? []);
    };
    reader.readAsText(file);
  };

  const runPreview = async () => {
    if (!csvText) return;
    setError(null);
    for (const req of REQUIRED_FIELDS) {
      if (!mapping[req]) {
        setError(`Please map a column for "${req}" before previewing.`);
        return;
      }
    }
    const res = await fetch('/api/admin/participants/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText, mapping, mode: 'preview' }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(typeof body.error === 'string' ? body.error : 'Preview failed');
      return;
    }
    setPreview(body);
  };

  const confirmImport = async () => {
    if (!csvText) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/participants/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, mapping, mode: 'confirm' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Import failed');
        return;
      }
      setResult(body);
      setPreview(null);
      onImported();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="peb-card">
      <h2 className="font-medium mb-1">Import participants from CSV</h2>
      <p className="text-muted text-sm mb-4">
        Any column names work — map your file's headers to the fields below.
      </p>

      <input
        type="file"
        accept=".csv"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="text-sm mb-4"
      />
      {fileName && <p className="text-xs text-muted mb-3">Loaded: {fileName}</p>}

      {headers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((field) => (
            <div key={field}>
              <label className="text-xs text-muted block mb-1">
                {field} {REQUIRED_FIELDS.includes(field as any) && <span className="text-red-400">*</span>}
              </label>
              <select
                className="w-full bg-surface border border-border rounded-lg p-2 text-sm"
                value={mapping[field] ?? ''}
                onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}
              >
                <option value="">— none —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {headers.length > 0 && !preview && (
        <button className="peb-btn-secondary" onClick={runPreview}>
          Preview
        </button>
      )}

      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

      {preview && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="text-sm mb-2">
            <span className="text-accent-cyan">{preview.validCount}</span> valid,{' '}
            <span className="text-red-400">{preview.invalidCount}</span> invalid out of {preview.totalRows} rows
            {preview.duplicateRegistrationIds?.length > 0 && (
              <span className="text-amber-400"> ({preview.duplicateRegistrationIds.length} duplicate IDs)</span>
            )}
          </div>
          {preview.invalidRows?.length > 0 && (
            <details className="text-xs text-muted mb-3">
              <summary className="cursor-pointer">Show invalid rows</summary>
              <ul className="mt-2 space-y-1">
                {preview.invalidRows.map((r: any) => (
                  <li key={r.rowIndex}>
                    Row {r.rowIndex}: {r.errors.join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button className="peb-btn-primary" onClick={confirmImport} disabled={confirming}>
            {confirming ? 'Importing…' : `Confirm Import (${preview.validCount} rows)`}
          </button>
        </div>
      )}

      {result && (
        <p className="text-sm text-accent-cyan mt-4">
          Imported {result.imported} new entries
          {result.skippedAsAlreadyImported > 0 && ` (${result.skippedAsAlreadyImported} already existed, skipped)`}.
        </p>
      )}
    </div>
  );
}

function ParticipantsTable({ refreshKey, onReset }: { refreshKey: number; onReset: () => void }) {
  const [entries, setEntries] = useState<EntryVM[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/participants');
      const body = await res.json();
      if (res.ok) setEntries(body.entries);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const toggle = async (entry: EntryVM) => {
    const present = !entry.present;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, present } : e)));
    await fetch('/api/admin/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: entry.id, present }),
    });
  };

  const resetAll = async () => {
    const typed = prompt(`This deletes ALL ${entries.length} imported participants and their attendance/submission history. Type RESET to confirm.`);
    if (typed !== 'RESET') return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch('/api/admin/participants', { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(body.error ?? 'Only an Admin account can reset participants.');
        return;
      }
      onReset();
    } finally {
      setResetting(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => {
        const haystack = [
          e.entry_code,
          e.team_name ?? '',
          e.payment_status,
          e.present ? 'present' : 'not checked in',
          ...(e.team_members?.map((m) => m.full_name) ?? []),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
    : entries;

  return (
    <div className="peb-card">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-medium">
          All participants ({filtered.length}
          {q ? ` of ${entries.length}` : ''})
        </h2>
        <div className="flex items-center gap-2">
          <input
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm w-48"
            placeholder="Search name, entry, status…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="text-xs text-muted hover:text-foreground" onClick={load}>
            Refresh
          </button>
          <button className="text-xs text-red-400 hover:text-red-300" onClick={resetAll} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset all'}
          </button>
        </div>
      </div>
      {resetError && <p className="text-sm text-red-400 mb-3">{resetError}</p>}
      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted text-sm">No participants imported yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted text-sm">No matches for "{query}".</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-2 pr-3">Entry</th>
                <th className="py-2 pr-3">Participant / Team</th>
                <th className="py-2 pr-3">Attendance</th>
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
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => toggle(e)}
                      className={`text-xs px-2 py-1 rounded-full ${
                        e.present ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {e.present ? 'PRESENT' : 'NOT CHECKED IN'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RegistrationDeskClient() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Registration Desk</h1>
        <p className="text-muted text-sm">Import participants, check them in, and track attendance.</p>
      </div>
      <AccessCodePanel />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LookupPanel />
        <CsvImportPanel onImported={() => setRefreshKey((k) => k + 1)} />
      </div>
      <ParticipantsTable refreshKey={refreshKey} onReset={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}
