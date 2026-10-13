'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Challenge {
  id: string;
  challenge_code: string;
  title: string;
  category: string | null;
  difficulty: string;
  active: boolean;
  common_slot: 1 | 2 | null;
  prompt_word_limit: number;
  output_char_limit: number;
}

export default function ChallengePoolClient() {
  const [items, setItems] = useState<Challenge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/challenges', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? 'Could not load challenges.');
    setItems(body.challenges ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = async (payload: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/challenges', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? 'Update failed.');
      await load();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? []).filter((c) => {
      const hay = `${c.challenge_code} ${c.title} ${c.category ?? ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [items, query]);

  const commonA = items?.find((c) => c.common_slot === 1) ?? null;
  const commonB = items?.find((c) => c.common_slot === 2) ?? null;
  const activePool = (items ?? []).filter((c) => c.active && c.common_slot === null).length;

  const toggleSelected = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Challenge pool</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Every entry gets Common A and Common B as challenges 1–2, plus two different random challenges from the active pool as 3–4 (spread evenly).
        Changes are locked once Round 1 has started.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <SlotCard label="Common A (challenge 1)" challenge={commonA} />
        <SlotCard label="Common B (challenge 2)" challenge={commonB} />
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Random pool</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{items ? activePool : '—'}</div>
          <div className="text-xs text-muted">active, non-common challenges</div>
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200" role="alert">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Filter by code, title, category…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter challenges" />
        <button className="peb-btn-secondary py-2" disabled={busy || selected.size === 0} onClick={() => patch({ action: 'set_active', ids: [...selected], active: true })}>Activate selected</button>
        <button className="peb-btn-secondary py-2" disabled={busy || selected.size === 0} onClick={() => patch({ action: 'set_active', ids: [...selected], active: false })}>Deactivate selected</button>
        <span className="text-xs text-muted">{selected.size} selected</span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-white/[0.03]">
            <tr className="text-xs text-muted">
              <th className="p-3"><input type="checkbox" aria-label="Select all shown" checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())} /></th>
              <th className="p-3">Code</th><th className="p-3">Title</th><th className="p-3">Category</th><th className="p-3">Limits</th><th className="p-3">Status</th><th className="p-3">Common</th>
            </tr>
          </thead>
          <tbody>
            {items === null ? (
              <tr><td colSpan={7} className="p-4 text-muted">Loading…</td></tr>
            ) : filtered.map((c) => (
              <tr key={c.id} className={`border-t border-white/5 ${c.active ? '' : 'opacity-50'}`}>
                <td className="p-3"><input type="checkbox" aria-label={`Select ${c.challenge_code}`} checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} /></td>
                <td className="p-3 font-mono text-xs">{c.challenge_code}</td>
                <td className="p-3">{c.title}</td>
                <td className="p-3 text-xs text-muted">{c.category ?? '—'}</td>
                <td className="p-3 text-xs text-muted">{c.prompt_word_limit} words · {c.output_char_limit} chars</td>
                <td className="p-3 text-xs">{c.active ? <span className="text-emerald-300">Active</span> : 'Inactive'}</td>
                <td className="p-3">
                  <div className="flex gap-1">
                    {([1, 2] as const).map((slot) => (
                      <button key={slot} disabled={busy}
                        onClick={() => patch({ action: 'set_common', slot, id: c.common_slot === slot ? null : c.id })}
                        className={`rounded-md border px-2 py-1 text-xs ${c.common_slot === slot ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
                        aria-pressed={c.common_slot === slot}>
                        {slot === 1 ? 'A' : 'B'}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlotCard({ label, challenge }: { label: string; challenge: Challenge | null }) {
  return (
    <div className={`rounded-2xl border p-4 ${challenge ? 'border-cyan-300/30 bg-cyan-300/[0.05]' : 'border-amber-300/30 bg-amber-400/[0.06]'}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      {challenge ? (
        <>
          <div className="mt-2 font-mono text-sm text-cyan-100">{challenge.challenge_code}</div>
          <div className="text-sm">{challenge.title}</div>
        </>
      ) : (
        <div className="mt-2 text-sm text-amber-100">Not chosen — pick one below.</div>
      )}
    </div>
  );
}
