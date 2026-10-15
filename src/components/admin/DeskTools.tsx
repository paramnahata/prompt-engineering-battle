'use client';

import { useState } from 'react';
import type { EntryVM } from './RegistrationDeskClient';

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
      const payload: Record<string, unknown> = { team_name: teamName, members: members.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.trim()]))), ...(entry ? { disqualified, disqualified_reason: reason } : {}) };
      const send = () => fetch(entry ? `/api/admin/participants/${entry.id}` : '/api/admin/participants', {
        method: entry ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      let res = await send();
      let body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === 'duplicate' && window.confirm(`${body.error}\n\nAdd this entry anyway?`)) {
        payload.allow_duplicate = true;
        res = await send();
        body = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');
      onSaved(entry ? `Entry ${entry.entry_number} updated.` : `Entry ${body.entryNumber} created. Its PIN is on the Registration desk.`);
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
