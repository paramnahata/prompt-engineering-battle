'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';

interface Row {
  entry_id: string;
  entry_number: number;
  team_name: string | null;
  member_names: string | null;
  session_started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  end_reason: string | null;
  status: 'online' | 'idle' | 'offline';
}

const STATUS_STYLE: Record<Row['status'], string> = {
  online: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  idle: 'bg-amber-400/15 text-amber-200 border-amber-400/30',
  offline: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
};

const END_REASON: Record<string, string> = {
  logout: 'Logged out',
  expired: 'Session expired',
  superseded: 'Signed in again',
  released_by_organizer: 'Released by organizer',
  replaced_on_device: 'Another login on device',
  account_changed: 'Entry changed',
};

function ago(iso: string, nowMs: number) {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/**
 * Collapsed by default. While open it polls every 10s (paused when the tab
 * is hidden, backs off on errors). Status comes from session heartbeats,
 * not from login history.
 */
export default function LiveParticipantsPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<{ online: number; idle: number; offline: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [filter, setFilter] = useState<'all' | Row['status']>('all');
  const [releasing, setReleasing] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/student-logins', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Could not load live participants.');
      throw new Error('load');
    }
    setRows(body.participants ?? []);
    setSummary(body.summary ?? null);
    setServerOffset(new Date(body.serverNow).getTime() - Date.now());
    setError(null);
  }, []);

  usePolling(load, 10_000, { enabled: open });
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [open]);

  const release = async (row: Row) => {
    if (!window.confirm(`Sign entry ${row.entry_number} out on every device? They can then sign in again on a new device.`)) return;
    setReleasing(row.entry_id);
    try {
      const res = await fetch('/api/admin/sessions/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: row.entry_id }) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not release the session.');
      }
      await load().catch(() => {});
    } finally {
      setReleasing(null);
    }
  };

  const visible = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || r.status === filter), [rows, filter]);
  const serverNow = now + serverOffset;

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-white/[0.03]"
        aria-expanded={open}
        aria-controls="live-participants"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <h2 className="font-semibold">Student Login Activity · Live Participants</h2>
          <p className="mt-1 text-sm text-muted">Who is signed in right now, from 20-second heartbeats.</p>
        </div>
        <span className="flex shrink-0 items-center gap-3 text-sm">
          {summary && (
            <span className="hidden gap-2 sm:flex">
              <span className="text-emerald-300">{summary.online} online</span>
              <span className="text-amber-200">{summary.idle} idle</span>
              <span className="text-slate-400">{summary.offline} offline</span>
            </span>
          )}
          <span aria-hidden="true" className="text-lg text-cyan-300">{open ? '−' : '+'}</span>
        </span>
      </button>

      {open && (
        <div id="live-participants" className="border-t border-white/10 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1" role="group" aria-label="Filter by status">
              {(['all', 'online', 'idle', 'offline'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${filter === f ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
                  {f}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Online: heartbeat &lt; 45s and tab visible · Idle: tab hidden or heartbeat &lt; 3 min · Offline: older, logged out or expired.</p>
          </div>
          {error && <p className="mb-3 text-sm text-rose-300" role="alert">{error}</p>}
          {rows === null ? (
            <p className="text-sm text-muted">Loading live participants…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted">{rows.length === 0 ? 'No student has signed in during the last 24 hours.' : 'Nobody matches this filter.'}</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-950">
                  <tr className="border-b border-white/10 text-xs text-muted">
                    <th className="py-2 pr-3">Entry</th><th className="py-2 pr-3">Team / participants</th><th className="py-2 pr-3">Signed in</th>
                    <th className="py-2 pr-3">Last activity</th><th className="py-2 pr-3">Status</th><th className="py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.entry_id} className="border-b border-white/5">
                      <td className="py-2 pr-3 font-semibold tabular-nums">{r.entry_number}</td>
                      <td className="py-2 pr-3">
                        <div>{r.team_name || r.member_names || 'Participant'}</div>
                        {r.team_name && r.member_names && <div className="text-xs text-muted">{r.member_names}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted">{new Date(r.session_started_at).toLocaleTimeString()}</td>
                      <td className="py-2 pr-3 text-xs text-muted">
                        {r.ended_at ? `${END_REASON[r.end_reason ?? ''] ?? 'Ended'} · ${new Date(r.ended_at).toLocaleTimeString()}` : ago(r.last_seen_at, serverNow)}
                      </td>
                      <td className="py-2 pr-3"><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                      <td className="py-2 text-right">
                        {!r.ended_at && (
                          <button className="text-xs text-slate-400 underline hover:text-white disabled:opacity-40" disabled={releasing === r.entry_id} onClick={() => void release(r)}>
                            {releasing === r.entry_id ? 'Releasing…' : 'Release'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
