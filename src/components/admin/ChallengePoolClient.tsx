'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';

type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'unrated';
type PoolStatus = 'approved' | 'review' | 'test' | 'archived';
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'expert', 'unrated'];
const STATUSES: PoolStatus[] = ['approved', 'review', 'test', 'archived'];

interface Row {
  id: string; challenge_code: string; title: string; category: string | null; difficulty: Difficulty; active: boolean;
  pool_status: PoolStatus; common_slot: 1 | 2 | null; prompt_word_limit: number; output_char_limit: number; source_ref: string | null;
}
interface Preflight {
  ok: boolean; errors: string[]; warnings: string[]; presentEntries: number; entriesWithoutPin: number; invalidTeamSize: number;
  slot3Eligible: number; slot4Eligible: number;
  common: { slot: number; chosen: boolean; code?: string; title?: string; difficulty?: string; eligible?: boolean }[];
  rules: Rules;
}
interface Rules { allowedDifficulties: Difficulty[]; slot3Difficulties: Difficulty[]; slot4Difficulties: Difficulty[]; allowedCategories: string[]; distinctCategories: boolean }
interface Facets { difficulty: Record<string, number>; status: Record<string, number>; category: Record<string, number>; total: number; active: number }

const DIFF_STYLE: Record<Difficulty, string> = {
  easy: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  medium: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  hard: 'bg-amber-400/10 text-amber-200 border-amber-400/20',
  expert: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
  unrated: 'bg-slate-400/10 text-slate-300 border-slate-400/20',
};
const STATUS_STYLE: Record<PoolStatus, string> = {
  approved: 'text-emerald-300', review: 'text-amber-200', test: 'text-violet-300', archived: 'text-slate-500',
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) window.location.replace('/organizer/login?next=/admin/challenges');
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'Request failed.'), { body, status: res.status });
  return body as T;
}

export default function ChallengePoolClient() {
  const [tab, setTab] = useState<'pool' | 'import' | 'rules' | 'history'>('pool');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Challenge pool</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Problem statements for Round 1. Only <b className="text-emerald-300">approved</b>, active questions that match the rules are assigned.
        Challenges given to a team are snapshotted, so later edits never change a past run.
      </p>
      <div className="mt-5 flex flex-wrap gap-1 border-b border-white/10" role="tablist">
        {([['pool', 'Pool'], ['import', 'Import / update file'], ['rules', 'Common A/B & rules'], ['history', 'History']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-cyan-300 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === 'pool' && <PoolTab refreshKey={refreshKey} onChanged={refresh} />}
        {tab === 'import' && <ImportTab onPublished={() => { refresh(); setTab('pool'); }} />}
        {tab === 'rules' && <RulesTab refreshKey={refreshKey} onChanged={refresh} />}
        {tab === 'history' && <HistoryTab refreshKey={refreshKey} />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Pool */

function PoolTab({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty[]>([]);
  const [status, setStatus] = useState<PoolStatus | ''>('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Row[]; total: number; pageSize: number; facets: Facets; preflight: Preflight | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const reqId = useRef(0);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [debouncedQ, difficulty, status, category, active]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const sp = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (debouncedQ) sp.set('q', debouncedQ);
    if (difficulty.length) sp.set('difficulty', difficulty.join(','));
    if (status) sp.set('status', status);
    if (category) sp.set('category', category);
    if (active) sp.set('active', active);
    try {
      const body = await api<typeof data & object>(`/api/admin/challenges?${sp}`);
      if (id === reqId.current) { setData(body); setError(null); }
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : 'Could not load.');
    }
  }, [page, debouncedQ, difficulty, status, category, active]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const bulk = async (payload: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/challenges', { method: 'PATCH', body: JSON.stringify(payload) });
      setSelected(new Set());
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.');
    } finally { setBusy(false); }
  };
  const remove = async () => {
    const n = selected.size;
    if (window.prompt(`Delete ${n} challenge(s)? Challenges that were ever assigned are archived instead (kept for history). Type DELETE to confirm.`) !== 'DELETE') return;
    setBusy(true);
    try {
      const r = await api<{ deleted: number; archived: number }>('/api/admin/challenges', { method: 'DELETE', body: JSON.stringify({ ids: [...selected], confirm: 'DELETE' }) });
      setError(null);
      window.alert(`Deleted ${r.deleted}, archived ${r.archived}.`);
      setSelected(new Set());
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed.'); } finally { setBusy(false); }
  };

  const ids = [...selected];
  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const categories = useMemo(() => Object.entries(data?.facets.category ?? {}).sort((a, b) => a[0].localeCompare(b[0])), [data]);

  return (
    <div>
      {data?.preflight && <ReadinessStrip preflight={data.preflight} />}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Search ID, title, category, text…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search challenges" />
        <div className="flex gap-1" role="group" aria-label="Difficulty filter">
          {DIFFS.map((d) => (
            <button key={d} aria-pressed={difficulty.includes(d)} onClick={() => setDifficulty((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d])}
              className={`rounded-full border px-2.5 py-1 text-xs capitalize ${difficulty.includes(d) ? DIFF_STYLE[d] : 'border-white/10 text-slate-400'}`}>
              {d} <span className="opacity-60">{data?.facets.difficulty[d] ?? 0}</span>
            </button>
          ))}
        </div>
        <select className="rounded-lg border border-border bg-surface px-2 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as PoolStatus | '')} aria-label="Status filter">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s} ({data?.facets.status[s] ?? 0})</option>)}
        </select>
        <select className="max-w-56 rounded-lg border border-border bg-surface px-2 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter">
          <option value="">All categories</option>
          {categories.map(([c, n]) => <option key={c} value={c === '(none)' ? '' : c}>{c} ({n})</option>)}
        </select>
        <select className="rounded-lg border border-border bg-surface px-2 py-2 text-sm" value={active} onChange={(e) => setActive(e.target.value as '' | 'true' | 'false')} aria-label="Enabled filter">
          <option value="">Enabled + disabled</option><option value="true">Enabled</option><option value="false">Disabled</option>
        </select>
        <button className="peb-btn-primary ml-auto py-2" onClick={() => setEditing('new')}>Add challenge</button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-300/20 bg-slate-950/95 p-2 text-sm shadow-xl">
          <span className="px-2 text-xs text-cyan-200">{selected.size} selected</span>
          <button className="rounded-lg px-2 py-1 hover:bg-white/10" disabled={busy} onClick={() => bulk({ action: 'bulk_update', ids, set: { pool_status: 'approved', active: true } })}>Approve</button>
          <button className="rounded-lg px-2 py-1 hover:bg-white/10" disabled={busy} onClick={() => bulk({ action: 'bulk_update', ids, set: { pool_status: 'review' } })}>Needs review</button>
          <button className="rounded-lg px-2 py-1 hover:bg-white/10" disabled={busy} onClick={() => bulk({ action: 'bulk_update', ids, set: { pool_status: 'test' } }, 'Mark as test/demo? Test questions are never assigned in the event.')}>Mark test/demo</button>
          <button className="rounded-lg px-2 py-1 hover:bg-white/10" disabled={busy} onClick={() => bulk({ action: 'bulk_update', ids, set: { active: true } })}>Enable</button>
          <button className="rounded-lg px-2 py-1 hover:bg-white/10" disabled={busy} onClick={() => bulk({ action: 'bulk_update', ids, set: { active: false } })}>Disable</button>
          <select className="rounded-lg border border-border bg-surface px-2 py-1 text-xs" value="" disabled={busy} onChange={(e) => e.target.value && bulk({ action: 'bulk_update', ids, set: { difficulty: e.target.value } })} aria-label="Set difficulty">
            <option value="">Set difficulty…</option>{DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="rounded-lg px-2 py-1 hover:bg-white/10" disabled={busy} onClick={() => { const c = window.prompt('New category for the selected challenges (empty to clear):'); if (c !== null) void bulk({ action: 'bulk_update', ids, set: { category: c } }); }}>Set category…</button>
          <button className="rounded-lg px-2 py-1 text-rose-300 hover:bg-rose-500/10" disabled={busy} onClick={() => void remove()}>Delete…</button>
          <button className="ml-auto rounded-lg px-2 py-1 text-xs text-slate-400" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200" role="alert">{error}</p>}

      <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs text-muted">
            <tr>
              <th className="p-3"><input type="checkbox" aria-label="Select page" checked={items.length > 0 && items.every((r) => selected.has(r.id))}
                onChange={(e) => setSelected((s) => { const n = new Set(s); for (const r of items) { if (e.target.checked) n.add(r.id); else n.delete(r.id); } return n; })} /></th>
              <th className="p-3">PS ID</th><th className="p-3">Title</th><th className="p-3">Category</th><th className="p-3">Difficulty</th>
              <th className="p-3">Status</th><th className="p-3">Limits</th><th className="p-3"><span className="sr-only">Edit</span></th>
            </tr>
          </thead>
          <tbody>
            {data === null ? (
              <tr><td colSpan={8} className="p-4 text-muted">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-muted">No challenges match. Import your workbook on the “Import / update file” tab.</td></tr>
            ) : items.map((r) => (
              <tr key={r.id} className={`border-t border-white/5 ${r.active && r.pool_status !== 'archived' ? '' : 'opacity-50'}`}>
                <td className="p-3"><input type="checkbox" aria-label={`Select ${r.challenge_code}`} checked={selected.has(r.id)} disabled={r.pool_status === 'archived'}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                <td className="whitespace-nowrap p-3 font-mono text-xs">{r.challenge_code}{r.common_slot && <span className="ml-2 rounded bg-cyan-300/15 px-1.5 py-0.5 text-xs text-cyan-100">Common {r.common_slot === 1 ? 'A' : 'B'}</span>}</td>
                <td className="p-3">{r.title}</td>
                <td className="p-3 text-xs text-muted">{r.category ?? '—'}</td>
                <td className="p-3"><span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${DIFF_STYLE[r.difficulty]}`}>{r.difficulty}</span></td>
                <td className={`p-3 text-xs capitalize ${STATUS_STYLE[r.pool_status]}`}>{r.pool_status}{!r.active && r.pool_status !== 'archived' && <span className="text-slate-500"> · disabled</span>}</td>
                <td className="whitespace-nowrap p-3 text-xs text-muted">{r.prompt_word_limit} w · {r.output_char_limit} ch</td>
                <td className="p-3 text-right"><button className="text-xs text-cyan-300 underline" onClick={() => setEditing(r.id)}>{r.pool_status === 'archived' ? 'View' : 'Edit'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>{data ? `${data.total} matching · ${data.facets.total} in pool · ${data.facets.active} enabled` : ''}</span>
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-white/10 px-3 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page} / {pages}</span>
          <button className="rounded-lg border border-white/10 px-3 py-1 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
      {editing && <ChallengeEditor id={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </div>
  );
}

function ReadinessStrip({ preflight }: { preflight: Preflight }) {
  return (
    <div className={`rounded-xl border p-3 text-sm ${preflight.errors.length ? 'border-amber-300/30 bg-amber-400/[0.06]' : 'border-emerald-300/20 bg-emerald-400/[0.05]'}`}>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>Eligible for slot 3: <b>{preflight.slot3Eligible}</b></span>
        <span>Eligible for slot 4: <b>{preflight.slot4Eligible}</b></span>
        {preflight.common.map((c) => (
          <span key={c.slot}>Common {c.slot === 1 ? 'A' : 'B'}: <b className={c.chosen && c.eligible ? 'text-cyan-200' : 'text-amber-200'}>{c.chosen ? c.code : 'not chosen'}</b></span>
        ))}
        <span className="text-muted">Allowed: {preflight.rules.allowedDifficulties.join(', ')}</span>
      </div>
      {preflight.errors.map((e) => <p key={e} className="mt-1 text-xs text-amber-200">⚠ {e}</p>)}
    </div>
  );
}

const EMPTY = {
  challenge_code: '', title: '', category: '', difficulty: 'medium' as Difficulty, problem_statement: '', expected_output: '',
  evaluation_criteria: '', instructions: '', constraints: '', prompt_word_limit: 150, output_char_limit: 2000,
  pool_status: 'review' as Exclude<PoolStatus, 'archived'>, active: true,
};

function ChallengeEditor({ id, onClose, onSaved }: { id: string | 'new'; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ ...EMPTY });
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(id !== 'new');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id === 'new') return;
    api<{ challenge: Record<string, unknown> }>(`/api/admin/challenges/${id}`).then(({ challenge: c }) => {
      setArchived(c.pool_status === 'archived');
      setForm({
        challenge_code: String(c.challenge_code ?? ''), title: String(c.title ?? ''), category: String(c.category ?? ''),
        difficulty: (c.difficulty as Difficulty) ?? 'unrated', problem_statement: String(c.problem_statement ?? ''),
        expected_output: String(c.expected_output ?? ''), evaluation_criteria: String(c.evaluation_criteria ?? ''),
        instructions: String(c.instructions ?? ''), constraints: String(c.constraints ?? ''),
        prompt_word_limit: Number(c.prompt_word_limit) || 150, output_char_limit: Number(c.output_char_limit) || 2000,
        pool_status: c.pool_status === 'archived' ? 'review' : (c.pool_status as 'approved' | 'review' | 'test'), active: Boolean(c.active),
      });
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(id === 'new' ? '/api/admin/challenges' : `/api/admin/challenges/${id}`, { method: id === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(form) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally { setSaving(false); }
  };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const field = 'mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-foreground disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="editor-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="my-8 w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <h2 id="editor-title" className="text-lg font-bold">{id === 'new' ? 'Add challenge' : archived ? 'Archived challenge (read-only)' : 'Edit challenge'}</h2>
        {loading ? <p className="mt-4 text-sm text-muted">Loading…</p> : (
          <fieldset disabled={archived || saving} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">PS ID<input className={field} value={form.challenge_code} onChange={(e) => set('challenge_code', e.target.value)} /></label>
            <label className="text-xs text-muted">Title (optional)<input className={field} value={form.title} onChange={(e) => set('title', e.target.value)} /></label>
            <label className="text-xs text-muted">Category<input className={field} value={form.category} onChange={(e) => set('category', e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted">Difficulty<select className={field} value={form.difficulty} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>{DIFFS.map((d) => <option key={d}>{d}</option>)}</select></label>
              <label className="text-xs text-muted">Status<select className={field} value={form.pool_status} onChange={(e) => set('pool_status', e.target.value as 'approved' | 'review' | 'test')}><option value="approved">approved</option><option value="review">needs review</option><option value="test">test / demo</option></select></label>
            </div>
            <label className="text-xs text-muted sm:col-span-2">Problem statement (shown to students)<textarea className={`${field} h-36`} value={form.problem_statement} onChange={(e) => set('problem_statement', e.target.value)} /></label>
            <label className="text-xs text-muted">Expected output (judge only)<textarea className={`${field} h-24`} value={form.expected_output} onChange={(e) => set('expected_output', e.target.value)} /></label>
            <label className="text-xs text-muted">Evaluation criteria (judge only)<textarea className={`${field} h-24`} value={form.evaluation_criteria} onChange={(e) => set('evaluation_criteria', e.target.value)} /></label>
            <label className="text-xs text-muted">Instructions (shown to students)<textarea className={`${field} h-20`} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} /></label>
            <label className="text-xs text-muted">Constraints (shown to students)<textarea className={`${field} h-20`} value={form.constraints} onChange={(e) => set('constraints', e.target.value)} /></label>
            <label className="text-xs text-muted">Prompt word limit<input type="number" min={10} max={2000} className={field} value={form.prompt_word_limit} onChange={(e) => set('prompt_word_limit', Number(e.target.value))} /></label>
            <label className="text-xs text-muted">AI output character limit<input type="number" min={100} max={50000} className={field} value={form.output_char_limit} onChange={(e) => set('output_char_limit', Number(e.target.value))} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Enabled</label>
          </fieldset>
        )}
        {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="peb-btn-secondary" onClick={onClose}>Close</button>
          {!archived && <button className="peb-btn-primary" disabled={saving || loading || !form.challenge_code || !form.problem_statement} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Import */

interface ImportPreview {
  batchId: string; fileName: string;
  totals: { parsed: number; new: number; changed: number; unchanged: number; errors: number; warnings: number; missingFromFile: number };
  sheets: { name: string; used: boolean; reason?: string; headerRow?: number; rows: number; mapping?: Record<string, string> }[];
  headers: string[]; difficultyCounts: Record<Difficulty, number>; categoryCounts: Record<string, number>;
  items: { code: string; title: string; category: string | null; difficulty: Difficulty; source_ref: string; statement: string; status: 'new' | 'changed' | 'unchanged'; changes: string[] }[];
  errors: { source_ref: string; code?: string; message: string }[]; warnings: { source_ref: string; code?: string; message: string }[]; missing: string[];
}

const MAPPABLE: [string, string][] = [
  ['challenge_code', 'PS ID *'], ['problem_statement', 'Problem statement *'], ['title', 'Title'], ['category', 'Category'],
  ['difficulty', 'Difficulty'], ['expected_output', 'Expected output'], ['evaluation_criteria', 'Evaluation criteria'],
  ['instructions', 'Instructions'], ['constraints', 'Constraints'], ['prompt_word_limit', 'Word limit'], ['output_char_limit', 'Char limit'],
];

function ImportTab({ onPublished }: { onPublished: () => void }) {
  const [file, setFile] = useState<{ name: string; sheets: { name: string; rows: string[][] }[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [failure, setFailure] = useState<{ message: string; headers?: string[]; sheets?: ImportPreview['sheets'] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'new' | 'changed' | 'unchanged'>('all');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [poolStatus, setPoolStatus] = useState<'approved' | 'review'>('approved');
  const [limits, setLimits] = useState({ prompt_word_limit: 150, output_char_limit: 2000 });
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const runPreview = async (f = file, m = mapping, ex = excluded) => {
    if (!f) return;
    setBusy('preview');
    setFailure(null);
    setResult(null);
    setAck(false);
    try {
      const body = await api<ImportPreview>('/api/admin/challenges/import', { method: 'POST', body: JSON.stringify({ fileName: f.name, sheets: f.sheets, mapping: m, excludedSheets: ex }) });
      setPreview(body);
    } catch (e) {
      const err = e as Error & { body?: { headers?: string[]; sheets?: ImportPreview['sheets'] } };
      setPreview(null);
      setFailure({ message: err.message, headers: err.body?.headers, sheets: err.body?.sheets });
    } finally { setBusy(null); }
  };

  const onFile = async (f: File) => {
    setPreview(null);
    setFailure(null);
    setResult(null);
    setMapping({});
    setExcluded([]);
    if (f.size > 4 * 1024 * 1024) return setFailure({ message: 'The file is larger than 4 MB.' });
    setBusy('reading');
    try {
      let sheets: { name: string; rows: string[][] }[];
      if (/\.xlsx$/i.test(f.name)) {
        const { readWorkbook } = await import('@/lib/challenges/read-workbook');
        sheets = await readWorkbook(await f.arrayBuffer());
      } else if (/\.csv$/i.test(f.name)) {
        const text = (await f.text()).replace(/^﻿/, '');
        const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
        sheets = [{ name: f.name.replace(/\.csv$/i, '').slice(0, 80), rows: (parsed.data as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? ''))) }];
      } else {
        setBusy(null);
        return setFailure({ message: 'Choose an Excel (.xlsx) or CSV (.csv) file. Old .xls files: open in Excel and “Save as .xlsx”.' });
      }
      const next = { name: f.name, sheets };
      setFile(next);
      await runPreview(next, {}, []);
    } catch {
      setFailure({ message: 'Could not read this file. Is it a valid .xlsx/.csv?' });
      setBusy(null);
    }
  };

  const publish = async () => {
    if (!preview) return;
    const n = preview.totals.new + preview.totals.changed;
    const msg = mode === 'replace'
      ? `Publish ${preview.fileName}? ${preview.totals.new} new, ${preview.totals.changed} updated, and ${preview.totals.missingFromFile} challenge(s) not in this file will be ARCHIVED (removed from the event, kept for history).`
      : `Publish ${preview.fileName}? ${preview.totals.new} new and ${preview.totals.changed} updated challenge(s) will be ${poolStatus === 'approved' ? 'approved for the event' : 'added as “needs review”'}.`;
    if (!window.confirm(msg)) return;
    setBusy('publish');
    try {
      const r = await api<{ inserted: number; updated: number; unchanged: number; archived: number }>(`/api/admin/challenges/import/${preview.batchId}`, {
        method: 'POST', body: JSON.stringify({ action: 'publish', mode, poolStatus, defaults: limits }),
      });
      setResult(`Published: ${r.inserted} added, ${r.updated} updated, ${r.unchanged} unchanged${mode === 'replace' ? `, ${r.archived} archived` : ''}.${n === 0 && !r.archived ? ' The pool already matched this file.' : ''}`);
      setPreview(null);
      setFile(null);
      onPublished();
    } catch (e) {
      setFailure({ message: e instanceof Error ? e.message : 'Publish failed.' });
    } finally { setBusy(null); }
  };

  const discard = async () => {
    if (!preview) return;
    await api(`/api/admin/challenges/import/${preview.batchId}`, { method: 'POST', body: JSON.stringify({ action: 'discard' }) }).catch(() => {});
    setPreview(null);
    setFile(null);
  };

  const headers = preview?.headers ?? failure?.headers ?? [];
  const sheets = preview?.sheets ?? failure?.sheets ?? [];
  const items = (preview?.items ?? []).filter((i) => filter === 'all' || i.status === filter);
  const needsAck = (preview?.totals.errors ?? 0) > 0 || mode === 'replace';

  return (
    <div className="space-y-4">
      <div className="peb-card">
        <h2 className="font-medium">1. Upload the problem-statement file</h2>
        <p className="mt-1 text-sm text-muted">
          Excel (.xlsx, every sheet is read) or CSV. Columns like <code>PS ID</code>, <code>Category</code>, <code>Difficulty</code>, <code>Challenge Prompt</code>,
          <code> Expected Output</code>, <code>Evaluation Criteria</code> are detected automatically; summary sheets are skipped. Nothing changes until you publish.
        </p>
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-3 text-sm text-slate-300 file:mr-3 file:rounded-md file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800" aria-label="Choose problem-statement file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
        {busy === 'reading' && <p className="mt-2 text-xs text-muted">Reading workbook…</p>}
        {busy === 'preview' && <p className="mt-2 text-xs text-muted">Checking against the live pool…</p>}
        {result && <p className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-2 text-sm text-emerald-100" role="status">{result}</p>}
        {failure && <p className="mt-3 rounded-lg border border-rose-400/20 bg-rose-500/10 p-2 text-sm text-rose-200" role="alert">{failure.message}</p>}
      </div>

      {(preview || failure?.headers) && file && (
        <div className="peb-card">
          <h2 className="font-medium">2. Check sheets and column mapping</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {sheets.map((s) => (
              <label key={s.name} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${s.used ? 'border-emerald-300/30' : 'border-white/10 text-muted'}`} title={s.reason ?? `header on row ${s.headerRow}`}>
                <input type="checkbox" checked={!excluded.includes(s.name) && s.used} disabled={!s.used && !excluded.includes(s.name)}
                  onChange={(e) => { const ex = e.target.checked ? excluded.filter((x) => x !== s.name) : [...excluded, s.name]; setExcluded(ex); void runPreview(file, mapping, ex); }} />
                {s.name} {s.used ? `· ${s.rows} PS` : `· skipped`}
              </label>
            ))}
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm">Column mapping {preview?.sheets.find((s) => s.used)?.mapping ? '(auto-detected — change only if wrong)' : ''}</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {MAPPABLE.map(([key, label]) => {
                const auto = preview?.sheets.find((s) => s.used)?.mapping?.[key];
                return (
                  <label key={key} className="text-xs text-muted">{label}
                    <select className="mt-1 block w-full rounded-lg border border-border bg-surface p-2 text-sm text-foreground" value={mapping[key] ?? auto ?? ''}
                      onChange={(e) => { const m = { ...mapping, [key]: e.target.value }; setMapping(m); void runPreview(file, m, excluded); }}>
                      <option value="">— not in file —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
          </details>
        </div>
      )}

      {preview && (
        <div className="peb-card">
          <h2 className="font-medium">3. Review changes against the live pool</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-6">
            {([['PS in file', preview.totals.parsed], ['New', preview.totals.new], ['Changed', preview.totals.changed], ['Unchanged', preview.totals.unchanged],
              ['Row errors (skipped)', preview.totals.errors], ['In pool, not in file', preview.totals.missingFromFile]] as const).map(([l, n]) => (
              <div key={l} className="rounded-lg border border-white/10 p-2"><div className={`text-xl font-bold tabular-nums ${l.startsWith('Row errors') && n ? 'text-rose-300' : ''}`}>{n}</div><div className="text-[11px] text-muted">{l}</div></div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Difficulty in file: {DIFFS.map((d) => `${d} ${preview.difficultyCounts[d] ?? 0}`).join(' · ')} — {Object.keys(preview.categoryCounts).length} categories.
          </p>
          {preview.errors.length > 0 && (
            <details className="mt-3" open>
              <summary className="cursor-pointer text-sm text-rose-300">{preview.errors.length} row(s) will be skipped</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-rose-200">{preview.errors.map((e, i) => <li key={i}>{e.source_ref}: {e.message}</li>)}</ul>
            </details>
          )}
          {preview.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-amber-200">{preview.warnings.length} warning(s)</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-amber-100">{preview.warnings.map((w, i) => <li key={i}>{w.source_ref}: {w.message}</li>)}</ul>
            </details>
          )}
          {preview.missing.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm">{preview.missing.length} challenge(s) in the pool are not in this file</summary>
              <p className="mt-2 font-mono text-xs text-muted">{preview.missing.join(', ')}</p>
            </details>
          )}
          <div className="mt-4 flex gap-1 text-xs">
            {(['all', 'new', 'changed', 'unchanged'] as const).map((f) => <button key={f} className={`rounded px-2 py-1 capitalize ${filter === f ? 'bg-white/10' : 'text-muted'}`} onClick={() => setFilter(f)}>{f}</button>)}
          </div>
          <div className="mt-2 max-h-[26rem] overflow-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-950 text-muted"><tr><th className="p-2">PS ID</th><th className="p-2">Category</th><th className="p-2">Difficulty</th><th className="p-2">Problem statement</th><th className="p-2">Change</th></tr></thead>
              <tbody>
                {items.slice(0, 700).map((i) => (
                  <tr key={i.code} className="border-t border-white/5 align-top">
                    <td className="whitespace-nowrap p-2 font-mono">{i.code}<div className="text-xs text-muted">{i.source_ref}</div></td>
                    <td className="p-2">{i.category ?? '—'}</td>
                    <td className="p-2"><span className={`rounded-full border px-2 py-0.5 capitalize ${DIFF_STYLE[i.difficulty]}`}>{i.difficulty}</span></td>
                    <td className="p-2 text-muted">{i.statement}{i.statement.length >= 220 ? '…' : ''}</td>
                    <td className="p-2">{i.status === 'new' ? <span className="text-emerald-300">New</span> : i.status === 'changed' ? <span className="text-amber-200" title={i.changes.join(', ')}>Updated: {i.changes.join(', ')}</span> : <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-6 font-medium">4. Publish to the live pool</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <fieldset className="rounded-lg border border-white/10 p-3 text-sm">
              <legend className="px-1 text-xs text-muted">How to apply</legend>
              <label className="flex items-start gap-2"><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> <span><b>Add &amp; update</b> — new PS are added, changed ones updated, everything else untouched.</span></label>
              <label className="mt-2 flex items-start gap-2"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> <span><b>Replace pool</b> — like above, and the {preview.totals.missingFromFile} challenge(s) not in this file are archived (test/demo ones are kept).</span></label>
            </fieldset>
            <fieldset className="rounded-lg border border-white/10 p-3 text-sm">
              <legend className="px-1 text-xs text-muted">Status of imported PS</legend>
              <label className="flex items-start gap-2"><input type="radio" checked={poolStatus === 'approved'} onChange={() => setPoolStatus('approved')} /> <span><b>Approved</b> — usable in the event (subject to difficulty rules).</span></label>
              <label className="mt-2 flex items-start gap-2"><input type="radio" checked={poolStatus === 'review'} onChange={() => setPoolStatus('review')} /> <span><b>Needs review</b> — imported but not assigned until you approve them in the Pool tab.</span></label>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                <label>Default prompt word limit<input type="number" min={10} max={2000} className="mt-1 w-full rounded border border-border bg-surface p-1.5 text-foreground" value={limits.prompt_word_limit} onChange={(e) => setLimits((l) => ({ ...l, prompt_word_limit: Number(e.target.value) }))} /></label>
                <label>Default AI-output char limit<input type="number" min={100} max={50000} className="mt-1 w-full rounded border border-border bg-surface p-1.5 text-foreground" value={limits.output_char_limit} onChange={(e) => setLimits((l) => ({ ...l, output_char_limit: Number(e.target.value) }))} /></label>
              </div>
              <p className="mt-1 text-[11px] text-muted">Defaults apply to new PS only (existing limits are kept unless the file has limit columns).</p>
            </fieldset>
          </div>
          {needsAck && (
            <label className="mt-3 flex items-start gap-2 text-sm text-amber-100">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I understand {preview.totals.errors ? `${preview.totals.errors} row(s) with errors will be skipped` : ''}{preview.totals.errors && mode === 'replace' ? ' and ' : ''}{mode === 'replace' ? `${preview.totals.missingFromFile} challenge(s) will be archived` : ''}.</span>
            </label>
          )}
          <div className="mt-4 flex gap-2">
            <button className="peb-btn-primary" disabled={!!busy || (needsAck && !ack) || !Number.isInteger(limits.prompt_word_limit) || !Number.isInteger(limits.output_char_limit)} onClick={() => void publish()}>
              {busy === 'publish' ? 'Publishing…' : 'Publish to live pool'}
            </button>
            <button className="peb-btn-secondary" disabled={!!busy} onClick={() => void discard()}>Discard draft</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Rules */

function RulesTab({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, list] = await Promise.all([
        api<{ rules: Rules; preflight: Preflight }>('/api/admin/challenges/rules'),
        api<{ facets: Facets }>('/api/admin/challenges?pageSize=10&status=approved'),
      ]);
      setPreflight(r.preflight);
      setRules(r.rules);
      setCategories(Object.keys(list.facets.category).filter((c) => c !== '(none)').sort());
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const save = async () => {
    if (!rules) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ preflight: Preflight; rules: Rules }>('/api/admin/challenges/rules', { method: 'PUT', body: JSON.stringify(rules) });
      setPreflight(r.preflight);
      setRules(r.rules);
      setSaved('Rules saved.');
      setTimeout(() => setSaved(null), 3000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); } finally { setBusy(false); }
  };
  const toggle = (k: 'allowedDifficulties' | 'slot3Difficulties' | 'slot4Difficulties', d: Difficulty) =>
    setRules((r) => r && ({ ...r, [k]: r[k].includes(d) ? r[k].filter((x) => x !== d) : [...r[k], d] }));

  if (!rules || !preflight) return <p className="text-sm text-muted">{error ?? 'Loading…'}</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {[1, 2].map((slot) => <CommonPicker key={slot} slot={slot as 1 | 2} current={preflight.common.find((c) => c.slot === slot)} onChanged={() => { void load(); onChanged(); }} />)}
      </div>

      <div className="peb-card">
        <h2 className="font-medium">Random challenges (slots 3 and 4)</h2>
        <p className="mt-1 text-sm text-muted">Only approved, enabled, non-common questions are used. Untick Easy to keep easy questions out of the real event.</p>
        <div className="mt-3 space-y-3 text-sm">
          {([['allowedDifficulties', 'Allowed difficulties (both slots)'], ['slot3Difficulties', 'Slot 3 only (optional — none = any allowed)'], ['slot4Difficulties', 'Slot 4 only (optional — none = any allowed)']] as const).map(([k, label]) => (
            <div key={k}>
              <div className="text-xs text-muted">{label}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {DIFFS.map((d) => (
                  <label key={d} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 capitalize ${rules[k].includes(d) ? DIFF_STYLE[d] : 'border-white/10 text-slate-400'}`}>
                    <input type="checkbox" className="sr-only" checked={rules[k].includes(d)} onChange={() => toggle(k, d)} /> {d}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div>
            <div className="text-xs text-muted">Categories (none selected = all categories)</div>
            <div className="mt-1 flex max-h-40 flex-wrap gap-1.5 overflow-auto">
              {categories.map((c) => (
                <label key={c} className={`rounded-full border px-2.5 py-0.5 text-xs ${rules.allowedCategories.some((x) => x.toLowerCase() === c.toLowerCase()) ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-slate-400'}`}>
                  <input type="checkbox" className="sr-only" checked={rules.allowedCategories.some((x) => x.toLowerCase() === c.toLowerCase())}
                    onChange={(e) => setRules((r) => r && ({ ...r, allowedCategories: e.target.checked ? [...r.allowedCategories, c] : r.allowedCategories.filter((x) => x.toLowerCase() !== c.toLowerCase()) }))} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rules.distinctCategories} onChange={(e) => setRules((r) => r && ({ ...r, distinctCategories: e.target.checked }))} /> Slots 3 and 4 must come from different categories (when possible)</label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="peb-btn-primary" disabled={busy || rules.allowedDifficulties.length === 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rules'}</button>
          {saved && <span className="text-xs text-emerald-300" role="status">{saved}</span>}
        </div>
        {error && <p className="mt-2 text-sm text-rose-300" role="alert">{error}</p>}
      </div>

      <div className={`peb-card ${preflight.ok ? '' : 'border-amber-300/30'}`}>
        <h2 className="font-medium">Readiness check (same check “Start Round 1” runs)</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-5">
          {([['Checked-in entries', preflight.presentEntries], ['Eligible slot 3', preflight.slot3Eligible], ['Eligible slot 4', preflight.slot4Eligible], ['Without PIN', preflight.entriesWithoutPin], ['Invalid team size', preflight.invalidTeamSize]] as const).map(([l, n]) => (
            <div key={l} className="rounded-lg border border-white/10 p-2"><div className="text-xl font-bold tabular-nums">{n}</div><div className="text-[11px] text-muted">{l}</div></div>
          ))}
        </div>
        {preflight.errors.map((e) => <p key={e} className="mt-2 text-sm text-rose-300">✕ {e}</p>)}
        {preflight.warnings.map((w) => <p key={w} className="mt-2 text-sm text-amber-200">⚠ {w}</p>)}
        {preflight.ok && preflight.warnings.length === 0 && <p className="mt-2 text-sm text-emerald-300">✓ Ready to start.</p>}
      </div>
    </div>
  );
}

function CommonPicker({ slot, current, onChanged }: { slot: 1 | 2; current?: Preflight['common'][number]; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!q.trim()) { setOptions([]); return; }
    const t = setTimeout(() => {
      api<{ items: Row[] }>(`/api/admin/challenges?status=approved&active=true&pageSize=10&q=${encodeURIComponent(q)}`).then((r) => setOptions(r.items)).catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const choose = async (id: string | null) => {
    setError(null);
    try {
      await api('/api/admin/challenges', { method: 'PATCH', body: JSON.stringify({ action: 'set_common', slot, id }) });
      setQ('');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not set.'); }
  };
  const label = slot === 1 ? 'A' : 'B';
  return (
    <div className={`rounded-2xl border p-4 ${current?.chosen && current.eligible ? 'border-cyan-300/30 bg-cyan-300/[0.05]' : 'border-amber-300/30 bg-amber-400/[0.06]'}`}>
      <div className="text-xs font-semibold text-slate-400">Common {label} — challenge {slot} for every team</div>
      {current?.chosen ? (
        <div className="mt-2">
          <span className="font-mono text-sm text-cyan-100">{current.code}</span> <span className="text-sm">{current.title}</span>
          <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs capitalize ${DIFF_STYLE[(current.difficulty as Difficulty) ?? 'unrated']}`}>{current.difficulty}</span>
          <button className="ml-3 text-xs text-slate-400 underline" onClick={() => void choose(null)}>Clear</button>
        </div>
      ) : <p className="mt-2 text-sm text-amber-100">Not chosen.</p>}
      <div className="relative mt-3">
        <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Search an approved PS by ID or title…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Choose Common ${label}`} />
        {options.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-white/10 bg-slate-950 shadow-xl">
            {options.map((o) => (
              <button key={o.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10" onClick={() => void choose(o.id)}>
                <span className="font-mono text-xs">{o.challenge_code}</span> · {o.title} <span className="text-xs capitalize text-muted">({o.difficulty})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-rose-300" role="alert">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------- History */

function HistoryTab({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ batches: { id: string; file_name: string; status: string; summary: Record<string, unknown>; created_at: string; published_at: string | null; publish_mode: string | null; uploaded_by: string | null; published_by: string | null }[]; events: { id: string; action: string; new_value: Record<string, unknown> | null; created_at: string; admin: { full_name: string } | null }[] } | null>(null);
  useEffect(() => { api<typeof data & object>('/api/admin/challenges/import').then(setData).catch(() => setData({ batches: [], events: [] })); }, [refreshKey]);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="peb-card overflow-x-auto">
        <h2 className="font-medium">File uploads</h2>
        <table className="mt-3 w-full min-w-[700px] text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-2">File</th><th>Status</th><th>Uploaded</th><th>Published</th><th>Result</th></tr></thead>
          <tbody>
            {data.batches.map((b) => (
              <tr key={b.id} className="border-t border-white/5 align-top">
                <td className="py-2 pr-3">{b.file_name}</td>
                <td className="pr-3 capitalize">{b.status}{b.publish_mode ? ` (${b.publish_mode})` : ''}</td>
                <td className="pr-3 text-xs text-muted">{new Date(b.created_at).toLocaleString()}<br />{b.uploaded_by}</td>
                <td className="pr-3 text-xs text-muted">{b.published_at ? <>{new Date(b.published_at).toLocaleString()}<br />{b.published_by}</> : '—'}</td>
                <td className="text-xs text-muted">{b.status === 'published' ? `+${b.summary.inserted ?? 0} new, ${b.summary.updated ?? 0} updated, ${b.summary.archived ?? 0} archived` : `${b.summary.parsed ?? 0} PS, ${b.summary.errors ?? 0} errors`}</td>
              </tr>
            ))}
            {data.batches.length === 0 && <tr><td colSpan={5} className="py-3 text-muted">No uploads yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="peb-card">
        <h2 className="font-medium">Pool changes</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {data.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 border-t border-white/5 py-1.5">
              <span className="text-xs text-muted">{new Date(e.created_at).toLocaleString()}</span>
              <span className="font-medium">{e.admin?.full_name ?? 'System'}</span>
              <span className="text-slate-300">{e.action.replace(/_/g, ' ')}</span>
              <span className="truncate text-xs text-muted">{JSON.stringify(e.new_value ?? {}).slice(0, 160)}</span>
            </li>
          ))}
          {data.events.length === 0 && <li className="text-muted">No changes yet.</li>}
        </ul>
      </div>
    </div>
  );
}
