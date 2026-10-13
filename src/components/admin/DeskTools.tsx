'use client';

import { useState } from 'react';
import type { EntryVM } from './RegistrationDeskClient';

export interface IssuedPin { entryId: string; entryNumber: number; teamName: string | null; members: string[]; pin: string }

/**
 * Shows freshly issued PINs exactly once. Print → one slip per team;
 * CSV is generated in the browser (never sent anywhere).
 */
export function PinSlips({ pins, onClose }: { pins: IssuedPin[]; onClose: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const download = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = ['Entry,Team,Members,PIN', ...pins.map((p) => [String(p.entryNumber), esc(p.teamName ?? ''), esc(p.members.join(' & ')), `="${p.pin}"`].join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `team-pins-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
    setAcknowledged(true);
  };
  return (
    <div className="pin-slips fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="pins-title">
      <style>{`@media print { body * { visibility: hidden !important; } .pin-slips, .pin-slips * { visibility: visible !important; } .pin-slips { position: absolute; inset: 0; background: white !important; color: black !important; } .pin-noprint { display: none !important; } .pin-slip { break-inside: avoid; border: 1px dashed #999 !important; color: black !important; background: white !important; } }`}</style>
      <div className="my-6 w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <div className="pin-noprint">
          <h2 id="pins-title" className="text-lg font-bold">{pins.length === 1 ? `PIN for entry ${pins[0]?.entryNumber}` : `${pins.length} team PINs`}</h2>
          <p className="mt-1 text-sm text-amber-200">
            These PINs are shown only now — they are stored encrypted (hashed) and can&apos;t be displayed again. Give each team its own slip.
            If a PIN is lost, issue a new one from the desk.
          </p>
          {pins.length === 0 && <p className="mt-3 text-sm text-muted">No PINs were issued (every entry already had one).</p>}
        </div>
        <div className={`mt-4 grid gap-3 ${pins.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {pins.map((p) => (
            <div key={p.entryId} className="pin-slip rounded-xl border border-white/15 p-4">
              <div className="text-xs uppercase tracking-wider text-muted">Prompt Engineering Battle · Team login</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div><div className="text-xs text-muted">Entry number</div><div className="text-3xl font-bold tabular-nums">{p.entryNumber}</div></div>
                <div className="text-right"><div className="text-xs text-muted">Team PIN</div><div className="font-mono text-3xl font-bold tracking-[0.25em]">{p.pin}</div></div>
              </div>
              <div className="mt-2 text-sm">{p.teamName || 'Individual'} — {p.members.join(', ')}</div>
              <div className="mt-1 text-[11px] text-muted">Keep this private. You also need the 4-digit code shown on the screen.</div>
            </div>
          ))}
        </div>
        <div className="pin-noprint mt-5 flex flex-wrap items-center justify-end gap-2">
          {pins.length > 0 && <button className="peb-btn-secondary" onClick={() => { window.print(); setAcknowledged(true); }}>Print slips</button>}
          {pins.length > 1 && <button className="peb-btn-secondary" onClick={download}>Download CSV</button>}
          <button className="peb-btn-primary" onClick={() => (acknowledged || pins.length <= 1 || window.confirm('Close without printing or downloading? These PINs cannot be shown again.')) && onClose()}>Done</button>
        </div>
      </div>
    </div>
  );
}

interface MemberForm { full_name: string; email: string; phone: string; college: string; branch: string; study_year: string; gender: string; city: string }
const emptyMember = (): MemberForm => ({ full_name: '', email: '', phone: '', college: '', branch: '', study_year: '', gender: '', city: '' });

/** Admin: create or edit an entry (1–2 members, each with their own contact details). */
export function EntryEditor({ entry, onClose, onSaved }: { entry: EntryVM | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [teamName, setTeamName] = useState(entry?.team_name ?? '');
  const [members, setMembers] = useState<MemberForm[]>(() => {
    const list = [...(entry?.team_members ?? [])].sort((a, b) => a.member_position - b.member_position).map((m) => ({
      full_name: m.full_name, email: m.email ?? '', phone: m.phone ?? '', college: m.college ?? '', branch: m.branch ?? '',
      study_year: m.study_year ?? '', gender: m.gender ?? '', city: m.city ?? '',
    }));
    return list.length ? list : [emptyMember()];
  });
  const [disqualified, setDisqualified] = useState(entry?.disqualified ?? false);
  const [reason, setReason] = useState(entry?.disqualified_reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, k: keyof MemberForm, v: string) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { team_name: teamName, members: members.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.trim()]))), ...(entry ? { disqualified, disqualified_reason: reason } : {}) };
      const res = await fetch(entry ? `/api/admin/participants/${entry.id}` : '/api/admin/participants', {
        method: entry ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');
      onSaved(entry ? `Entry ${entry.entry_number} updated.` : `Entry ${body.entryNumber} created — issue its PIN next.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const field = 'mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-foreground';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <h2 id="entry-editor-title" className="text-lg font-bold">{entry ? `Edit entry ${entry.entry_number}` : 'Add entry'}</h2>
        <label className="mt-4 block text-xs text-muted">Team name (optional for individuals)<input className={field} value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={120} /></label>
        {members.map((m, i) => (
          <fieldset key={i} className="mt-4 rounded-xl border border-white/10 p-3">
            <legend className="px-1 text-xs text-muted">Member {i + 1}{i === 0 ? ' (required)' : ''}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted">Full name<input className={field} value={m.full_name} onChange={(e) => update(i, 'full_name', e.target.value)} /></label>
              <label className="text-xs text-muted">Email<input type="email" className={field} value={m.email} onChange={(e) => update(i, 'email', e.target.value)} /></label>
              <label className="text-xs text-muted">Phone<input inputMode="tel" className={field} value={m.phone} onChange={(e) => update(i, 'phone', e.target.value)} /></label>
              <label className="text-xs text-muted">College<input className={field} value={m.college} onChange={(e) => update(i, 'college', e.target.value)} /></label>
              <label className="text-xs text-muted">Branch<input className={field} value={m.branch} onChange={(e) => update(i, 'branch', e.target.value)} /></label>
              <label className="text-xs text-muted">Year<input className={field} value={m.study_year} onChange={(e) => update(i, 'study_year', e.target.value)} /></label>
            </div>
            {i === 1 && <button className="mt-2 text-xs text-rose-300 underline" onClick={() => setMembers((ms) => ms.slice(0, 1))}>Remove member 2</button>}
          </fieldset>
        ))}
        {members.length < 2 && <button className="mt-3 text-sm text-cyan-300 underline" onClick={() => setMembers((ms) => [...ms, emptyMember()])}>Add second member (max 2)</button>}
        {entry && (
          <div className="mt-4 rounded-xl border border-rose-400/20 p-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={disqualified} onChange={(e) => setDisqualified(e.target.checked)} /> Disqualified (signs the team out and blocks login)</label>
            {disqualified && <input className={field} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="peb-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="peb-btn-primary" disabled={busy || members.some((m) => !m.full_name.trim())} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
