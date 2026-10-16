'use client';

import { useState } from 'react';

const FIELD_LABELS: Record<string, string> = {
  sr_no: 'Serial no.', registration_id: 'Registration ID', full_name: 'Name *', team_name: 'Team name',
  phone: 'Phone', email: 'Email', gender: 'Gender', college: 'College', city: 'City', branch: 'Branch',
  study_year: 'Year', registered_at: 'Registered at', member2_name: 'Member 2 name (wide sheets)',
  member2_email: 'Member 2 email', member2_phone: 'Member 2 phone',
};
const MAX_BYTES = 2 * 1024 * 1024;

interface PreviewMember { position: number; full_name: string; email: string; phone: string; college: string; branch: string; source_row: number }
interface PreviewEntry {
  registrationId: string; registrationIdGenerated: boolean; teamName: string; firstRow: number;
  members: PreviewMember[]; errors: string[]; warnings: string[]; alreadyImported: boolean; willUpdate?: boolean;
}
interface Preview {
  headers: string[]; mapping: Record<string, string>; headerRow: number; totalDataRows: number;
  totals: { entries: number; members: number; valid: number; invalid: number; alreadyImported: number; toImport: number; toUpdate?: number };
  warnings: string[]; entries: PreviewEntry[];
}

export default function CsvImportPanel({ onImported }: { onImported: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [view, setView] = useState<'all' | 'issues'>('all');

  const requestPreview = async (text: string, map: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/participants/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: text, mapping: map, mode: 'preview' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreview(null);
        setError(body.error ?? 'Could not read this file.');
        return;
      }
      setPreview(body);
      setMapping(body.mapping ?? {});
    } catch {
      setError('Connection problem while previewing. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File) => {
    setResult(null);
    setError(null);
    setPreview(null);
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setError('Please choose a .csv file (in Google Sheets: File → Download → Comma-separated values).');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('This file is larger than 2 MB.');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      setMapping({});
      void requestPreview(text, {});
    };
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(file, 'utf-8');
  };

  const changeMapping = (field: string, header: string) => {
    if (!csvText) return;
    const next = { ...mapping, [field]: header };
    setMapping(next);
    void requestPreview(csvText, next);
  };

  const confirmImport = async () => {
    if (!csvText || !preview) return;
    if (!window.confirm(`Import ${preview.totals.toImport} new entr${preview.totals.toImport === 1 ? 'y' : 'ies'}${preview.totals.toUpdate ? ` and update details of ${preview.totals.toUpdate} existing team${preview.totals.toUpdate === 1 ? '' : 's'}` : ''}? Entry numbers of existing teams do not change; new teams continue from the highest number.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/participants/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, mapping, mode: 'confirm' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Import failed.');
        return;
      }
      const upd = body.updated ? ` Updated details of ${body.updated} existing team${body.updated === 1 ? '' : 's'}.` : '';
      setResult(body.imported
        ? `Imported ${body.imported} entr${body.imported === 1 ? 'y' : 'ies'} as entry numbers ${body.firstEntryNumber}–${body.lastEntryNumber}.${upd}`
        : upd ? upd.trim() : 'Nothing new to import — every entry in this file already exists with the same details.');
      setPreview(null);
      setCsvText(null);
      setFileName(null);
      onImported();
    } catch {
      setError('Connection problem during import. Nothing was partially saved; try again.');
    } finally {
      setBusy(false);
    }
  };

  const shown = preview?.entries.filter((e) => view === 'all' || e.errors.length || e.warnings.length) ?? [];

  return (
    <div className="peb-card">
      <h2 className="mb-1 font-medium">Import participants from CSV</h2>
      <p className="mb-4 text-sm text-muted">
        Export the registration sheet as CSV. Teams spread over several rows (merged Team name / ID cells) are grouped automatically,
        and every member keeps their own email and phone. Re-importing the same file never creates duplicates.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} className="mb-3 text-sm text-slate-300 file:mr-3 file:rounded-md file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800" aria-label="Choose CSV file" />
      {fileName && <p className="mb-3 text-xs text-muted">File: {fileName}{busy ? ' · reading…' : ''}</p>}
      {error && <p className="mb-3 rounded-lg border border-rose-400/20 bg-rose-500/10 p-2 text-sm text-rose-200" role="alert">{error}</p>}
      {result && <p className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-2 text-sm text-emerald-100" role="status">{result}</p>}

      {preview && (
        <div className="mt-2 space-y-4">
          <details className="rounded-lg border border-white/10 p-3">
            <summary className="cursor-pointer text-sm font-medium">Column mapping (header found on row {preview.headerRow}) — adjust if something is wrong</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.keys(FIELD_LABELS).map((field) => (
                <label key={field} className="text-xs text-muted">
                  {FIELD_LABELS[field]}
                  <select className="mt-1 block w-full rounded-lg border border-border bg-surface p-2 text-sm text-foreground" value={mapping[field] ?? ''} onChange={(e) => changeMapping(field, e.target.value)} disabled={busy}>
                    <option value="">— not in file —</option>
                    {preview.headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </details>

          <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-5">
            {[
              ['Entries', preview.totals.entries],
              ['Members', preview.totals.members],
              ['New to import', preview.totals.toImport],
              ['Already imported', preview.totals.alreadyImported],
              ['Details to update', preview.totals.toUpdate ?? 0],
              ['With errors', preview.totals.invalid],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-lg border border-white/10 p-2">
                <div className={`text-xl font-bold tabular-nums ${label === 'With errors' && Number(n) > 0 ? 'text-rose-300' : ''}`}>{n}</div>
                <div className="text-[11px] text-muted">{label}</div>
              </div>
            ))}
          </div>
          {preview.warnings.map((w) => <p key={w} className="text-xs text-amber-200">⚠ {w}</p>)}

          <div className="flex items-center gap-2 text-xs">
            <button className={`rounded px-2 py-1 ${view === 'all' ? 'bg-white/10' : ''}`} onClick={() => setView('all')}>All entries</button>
            <button className={`rounded px-2 py-1 ${view === 'issues' ? 'bg-white/10' : ''}`} onClick={() => setView('issues')}>Only errors &amp; warnings</button>
          </div>

          <div className="max-h-[28rem] overflow-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-950">
                <tr className="text-muted"><th className="p-2">Rows</th><th className="p-2">Reg. ID</th><th className="p-2">Team</th><th className="p-2">Members (own email · phone)</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={`${e.registrationId}-${e.firstRow}`} className={`border-t border-white/5 align-top ${e.errors.length ? 'bg-rose-500/[0.06]' : ''}`}>
                    <td className="p-2 tabular-nums">{e.firstRow}</td>
                    <td className="p-2 font-mono">{e.registrationIdGenerated ? <span className="text-muted" title="Generated from team details">auto</span> : e.registrationId}</td>
                    <td className="p-2">{e.teamName || <i className="text-muted">—</i>}</td>
                    <td className="p-2">
                      {e.members.map((m) => (
                        <div key={m.position} className="mb-1">
                          <span className="font-medium text-foreground">{m.full_name}</span>
                          <span className="text-muted"> · {m.email || 'no email'} · {m.phone || 'no phone'}</span>
                        </div>
                      ))}
                      {[...e.errors.map((x) => ['err', x]), ...e.warnings.map((x) => ['warn', x])].map(([k, msg], i) => (
                        <div key={i} className={k === 'err' ? 'text-rose-300' : 'text-amber-200'}>{k === 'err' ? '✕' : '⚠'} {msg}</div>
                      ))}
                    </td>
                    <td className="whitespace-nowrap p-2">{e.errors.length ? <span className="text-rose-300">Error</span> : e.alreadyImported ? (e.willUpdate ? <span className="text-cyan-300">Update</span> : <span className="text-muted">Exists</span>) : <span className="text-emerald-300">New</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="peb-btn-primary" onClick={() => void confirmImport()} disabled={busy || preview.totals.invalid > 0 || (preview.totals.toImport === 0 && !preview.totals.toUpdate)}>
            {busy ? 'Working…' : preview.totals.invalid > 0 ? 'Fix errors before importing' : preview.totals.toImport === 0 && preview.totals.toUpdate ? `Update ${preview.totals.toUpdate} team${preview.totals.toUpdate === 1 ? '' : 's'}` : `Import ${preview.totals.toImport} new entr${preview.totals.toImport === 1 ? 'y' : 'ies'}${preview.totals.toUpdate ? ` + update ${preview.totals.toUpdate}` : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
