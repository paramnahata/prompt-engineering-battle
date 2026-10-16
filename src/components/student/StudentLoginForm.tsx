'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import AuthFrame from '@/components/auth/AuthFrame';
import { Alert } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { timeoutSignal } from '@/lib/client/api';

const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);

export default function StudentLoginForm({ organizerSignedIn, setupIssue }: { organizerSignedIn: boolean; setupIssue?: string | null }) {
  const [entryNumber, setEntryNumber] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/student/login', {
        signal: timeoutSignal(20_000),
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ entryCode: entryNumber.trim(), pin: pin.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Sign-in failed. Check your details and try again.');
        setLoading(false);
        return;
      }
      window.location.replace('/student/waiting');
    } catch {
      setError('Connection problem. Check the Wi-Fi and try again.');
      setLoading(false);
    }
  };

  const input = 'peb-input py-3 text-lg tabular';
  return (
    <AuthFrame aside={
      <div>
        <h1 className="font-display text-[3.4rem] font-semibold leading-[1.02] text-white" style={{ fontVariationSettings: "'wdth' 84" }}>Write the prompt that wins.</h1>
        <p className="mt-5 max-w-md text-lg leading-8 text-slate-300">Four timed challenges. One shot at the final. Check in at the registration desk — they’ll give you your team’s PIN.</p>
        <ul className="mt-8 space-y-3 text-slate-300">
          <li className="flex gap-3"><span className="font-display text-xl font-semibold text-violet-300">1</span><span><span className="text-white">Entry number</span> — your team’s number at the registration desk.</span></li>
          <li className="flex gap-3"><span className="font-display text-xl font-semibold text-violet-300">2</span><span><span className="text-white">Team PIN</span> — six digits from the desk. It changes every minute, so type it straight away.</span></li>
        </ul>
      </div>
    }>
      <h2 className="text-2xl font-semibold text-white">Student sign in</h2>
      <p className="mt-1 text-sm text-muted">Your team can be signed in on one device at a time.</p>
      {setupIssue && <Alert tone="error" className="mt-5">{setupIssue}</Alert>}
      {organizerSignedIn && <Alert tone="warning" className="mt-5">This browser is signed in as an organizer. Signing in as a student replaces that session.</Alert>}
      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <div>
          <label htmlFor="entryNumber" className="peb-label">Entry number</label>
          <input id="entryNumber" className={input} placeholder="e.g. 42" inputMode="numeric" autoComplete="username" maxLength={5} value={entryNumber}
            onChange={(e) => setEntryNumber(digits(e.target.value, 5))} required autoFocus />
        </div>
        <div>
          <label htmlFor="pin" className="peb-label">Team PIN</label>
          <input id="pin" type="password" className={`${input} tracking-[0.35em] placeholder:tracking-normal`} placeholder="6 digits" inputMode="numeric" autoComplete="current-password" maxLength={6}
            value={pin} onChange={(e) => setPin(digits(e.target.value, 6))} required aria-describedby="pin-help" />
          <p id="pin-help" className="peb-help">Ask the registration desk for your team’s current PIN — it changes every minute.</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!entryNumber || pin.length !== 6}>
          {loading ? 'Checking…' : <>Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
        </Button>
      </form>
    </AuthFrame>
  );
}
