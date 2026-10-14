'use client';

import { useCallback, useEffect, useState } from 'react';

interface Challenge { challenge_code: string; title: string; problem_statement: string; prompt_word_limit: number; output_char_limit: number }
interface PSRow {
  assignment: { id: string; position: number; is_common: boolean; challenge: Challenge | Challenge[] | null };
  submission: { id: string; prompt_text: string; ai_output_text: string; status: string; submitted_at: string | null; submission_ref: string | null; last_saved_at: string | null } | null;
  aiEval: {
    prompt_clarity: number; context: number; specificity: number; creativity: number; constraint_handling: number; total: number;
    originality_score: number | null; plagiarism_flag: boolean; flags: string[] | null; summary: string | null; model: string | null; rubric_version: string | null;
  } | null;
  latestReview: { old_total: number | null; new_total: number; reason: string; created_at: string } | null;
  job: { status: string; retry_count: number; last_error: string | null } | null;
}
interface EntryVM {
  entry_number: number; registration_id: string; team_name: string | null; is_team: boolean; present: boolean; disqualified: boolean;
  team_members: { member_position: number; full_name: string; email: string | null; phone: string | null; college: string | null; branch: string | null }[];
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default function EntryDetailClient({ entryId }: { entryId: string }) {
  const [entry, setEntry] = useState<EntryVM | null>(null);
  const [ps, setPs] = useState<PSRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/entries/${encodeURIComponent(entryId)}/round1`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to load this entry.');
      setEntry(body.entry);
      setPs(Array.isArray(body.ps) ? body.ps : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this entry.');
    } finally {
      setLoading(false);
    }
  }, [entryId]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !entry) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <div className="text-sm text-red-400">{error} <button className="ml-3 underline" onClick={() => void load()}>Retry</button></div>;
  if (!entry) return <p className="text-sm text-muted">Entry not found.</p>;

  const members = [...(entry.team_members ?? [])].sort((a, b) => a.member_position - b.member_position);
  const total = ps.reduce((sum, r) => sum + Number(r.latestReview?.new_total ?? r.aiEval?.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">Entry</div>
          <h1 className="text-3xl font-bold tabular-nums">{entry.entry_number}</h1>
          <p className="text-sm">{entry.team_name || (entry.is_team ? 'Unnamed team' : 'Individual')} <span className="text-xs text-muted">· Reg. ID {entry.registration_id}</span></p>
          <ul className="mt-1 text-xs text-muted">
            {members.map((m) => <li key={m.member_position}>{m.full_name} · {m.email || 'no email'} · {m.phone || 'no phone'}</li>)}
          </ul>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Round 1 total</div>
          <div className="text-2xl font-bold text-accent-cyan tabular-nums">{total.toFixed(1)} <span className="text-sm text-muted">/ {ps.length * 50 || 200}</span></div>
        </div>
      </div>

      {ps.length === 0 && <p className="peb-card text-sm text-muted">No Round 1 challenges assigned to this entry.</p>}

      {ps.map((row) => {
        const ch = one(row.assignment.challenge);
        const effective = row.latestReview?.new_total ?? row.aiEval?.total ?? null;
        return (
          <div key={row.assignment.id} className="peb-card">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-muted">Challenge {row.assignment.position} {row.assignment.is_common && '· common'} {ch && `· ${ch.challenge_code}`}</div>
                <div className="font-medium">{ch?.title ?? 'Challenge unavailable'}</div>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs ${row.submission?.status === 'submitted' ? 'bg-green-500/20 text-green-400' : row.submission?.status === 'locked' ? 'bg-amber-500/20 text-amber-300' : 'bg-surface text-muted'}`}>
                {row.submission?.status ?? 'not started'}
              </span>
            </div>
            <details className="mb-3 text-xs text-muted"><summary className="cursor-pointer">Problem statement</summary><p className="mt-2 whitespace-pre-wrap">{ch?.problem_statement}</p></details>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted">Prompt</div>
                <div className="min-h-[3rem] whitespace-pre-wrap rounded-lg border border-border bg-surface p-2 text-sm">{row.submission?.prompt_text || <span className="text-muted">— empty —</span>}</div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">AI output</div>
                <div className="min-h-[3rem] whitespace-pre-wrap rounded-lg border border-border bg-surface p-2 text-sm">{row.submission?.ai_output_text || <span className="text-muted">— empty —</span>}</div>
              </div>
            </div>
            {row.aiEval ? (
              <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted">
                <span>Clarity {row.aiEval.prompt_clarity}</span><span>Context {row.aiEval.context}</span><span>Specificity {row.aiEval.specificity}</span>
                <span>Creativity {row.aiEval.creativity}</span><span>Constraints {row.aiEval.constraint_handling}</span>
                {row.aiEval.originality_score !== null && <span>Originality {row.aiEval.originality_score}</span>}
                {row.aiEval.plagiarism_flag && <span className="text-red-400">⚠ Copied problem text</span>}
                <span className="text-slate-500">{row.aiEval.model} · {row.aiEval.rubric_version}</span>
              </div>
            ) : (
              <p className="mb-2 text-xs text-muted">
                Not evaluated yet{row.job ? ` · job ${row.job.status}${row.job.retry_count ? ` (${row.job.retry_count} attempts)` : ''}` : ''}
                {row.job?.last_error && <span className="block text-rose-300">{row.job.last_error}</span>}
              </p>
            )}
            {row.aiEval?.summary && <p className="mb-2 text-xs italic text-slate-300">“{row.aiEval.summary}”</p>}
            {!!row.aiEval?.flags?.length && <p className="mb-2 text-xs text-amber-300">Flags: {row.aiEval.flags.join(', ')}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                Score: <span className="font-semibold text-accent-cyan">{effective ?? '—'}</span> / 50
                {row.latestReview && <span className="ml-2 text-xs text-muted">(manual override from {row.latestReview.old_total ?? '—'}: {row.latestReview.reason})</span>}
              </div>
              {row.submission && editing !== row.submission.id && (
                <button className="peb-btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(row.submission!.id)}>Override score</button>
              )}
            </div>
            {row.submission && editing === row.submission.id && (
              <OverrideForm entryId={entryId} submissionId={row.submission.id} current={effective} onDone={() => { setEditing(null); void load(); }} onCancel={() => setEditing(null)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OverrideForm({ entryId, submissionId, current, onDone, onCancel }: { entryId: string; submissionId: string; current: number | null; onDone: () => void; onCancel: () => void }) {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(value);
  const valid = value !== '' && Number.isFinite(n) && n >= 0 && n <= 50 && reason.trim().length >= 3;

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/entries/${encodeURIComponent(entryId)}/round1`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, newTotal: n, reason: reason.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? 'Could not save.');
    onDone();
  };

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-[8rem_1fr_auto]">
      <label className="text-xs text-muted">New score (0–50)<input type="number" min={0} max={50} step={0.5} className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-foreground" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <label className="text-xs text-muted">Reason (recorded in audit log)<input className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-foreground" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      <div className="flex items-end gap-2">
        <button className="peb-btn-primary px-3 py-2" disabled={!valid || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="peb-btn-secondary px-3 py-2" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {error && <p className="text-xs text-rose-300 sm:col-span-3">{error}</p>}
    </div>
  );
}
