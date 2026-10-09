'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react';

type Settings = { configured: boolean; source: 'environment' | 'admin-panel' | 'none'; environmentOverride: boolean };
export default function GeminiSettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai-settings', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to read settings.');
      setSettings(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read settings.'); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveKey() {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/ai-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save the key.');
      setApiKey(''); setMessage(data.message || 'Gemini key saved.'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save the key.'); }
    finally { setBusy(false); }
  }

  async function removeKey() {
    if (!window.confirm('Remove the saved Gemini API key?')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/ai-settings', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to remove the key.');
      setMessage(data.message || 'Saved key removed.'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to remove the key.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="peb-card space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border p-3"><KeyRound className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold">Gemini API key</h2>
          <p className="text-sm text-muted mt-1">Used by the server-side AI judging worker. The key is never sent back to the browser.</p>
        </div>
      </div>
      <div className="rounded-lg border p-4 flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-sm">{settings?.configured ? 'Gemini is configured' : 'Gemini key not configured'}</p>
          <p className="text-muted text-xs mt-1">{settings?.source === 'environment' ? 'Source: Vercel environment variable' : settings?.source === 'admin-panel' ? 'Source: encrypted admin-panel setting' : settings ? 'Add a key below to enable AI judging.' : 'Checking configuration…'}</p>
        </div>
        {settings?.configured && <CheckCircle2 className="ml-auto h-5 w-5 shrink-0" />}
      </div>
      {settings?.environmentOverride && <p className="text-sm">The deployment has GEMINI_API_KEY configured. Remove that environment variable in Vercel if you want to manage the key here.</p>}
      <label className="block">
        <span className="text-sm font-medium">New Gemini API key</span>
        <div className="flex gap-2 mt-2">
          <input className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm" type={showKey ? 'text' : 'password'} autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste key from Google AI Studio" disabled={busy || settings?.environmentOverride} />
          <button type="button" className="peb-btn-secondary px-3" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide key' : 'Show key'}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="peb-btn-primary inline-flex items-center gap-2" onClick={saveKey} disabled={busy || apiKey.trim().length < 20 || settings?.environmentOverride}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Validate &amp; save key
        </button>
        {settings?.source === 'admin-panel' && <button type="button" className="peb-btn-secondary inline-flex items-center gap-2" onClick={removeKey} disabled={busy}><Trash2 className="h-4 w-4" /> Remove saved key</button>}
        <button type="button" className="peb-btn-secondary" onClick={() => { setError(''); setMessage(''); void refresh(); }} disabled={busy}>Refresh status</button>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="border-t pt-4 text-muted text-xs space-y-1">
        <p>Security: stored using AES-256-GCM encryption with SESSION_SECRET; only admin sessions can change this setting.</p>
        <p>Model: Gemini 2.5 Flash. A successful save first validates the key with Google AI.</p>
      </div>
    </section>
  );
}
