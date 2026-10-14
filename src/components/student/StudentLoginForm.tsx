'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import AuthFrame from '@/components/auth/AuthFrame';
import { Alert } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';

const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);

export default function StudentLoginForm({ organizerSignedIn, setupIssue }: { organizerSignedIn: boolean; setupIssue?: string | null }) {
  const [entryNumber, setEntryNumber] = useState('');
  const [pin, setPin] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/student/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ entryCode: entryNumber.trim(), pin: pin.trim(), accessCode: accessCode.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Sign-in failed. Check your details and try again.');
        if (body.code === 'bad_access_code') setAccessCode('');
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
        <p className="mt-5 max-w-md text-lg leading-8 text-slate-300">Four timed challenges. One shot at the final. Sign in with the details from your PIN slip and the code on the big screen.</p>
        <ul className="mt-8 space-y-3 text-slate-300">
          <li className="flex gap-3"><span className="font-display text-xl font-semibold text-violet-300">1</span><span><span className="text-white">Entry number</span> — printed on your PIN slip.</span></li>
          <li className="flex gap-3"><span className="font-display text-xl font-semibold text-violet-300">2</span><span><span className="text-white">Team PIN</span> — six digits, also on your slip. Keep it private.</span></li>
          <li className="flex gap-3"><span className="font-display text-xl font-semibold text-violet-300">3</span><span><span className="text-white">Room code</span> — four digits on the projector. It changes every two minutes.</span></li>
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
          <p id="pin-help" className="peb-help">Lost it? The registration desk can issue a new PIN.</p>
        </div>
        <div>
          <label htmlFor="accessCode" className="peb-label">Room code</label>
          <input id="accessCode" className={`${input} tracking-[0.35em] placeholder:tracking-normal`} placeholder="4 digits" inputMode="numeric" maxLength={4} autoComplete="off"
            value={accessCode} onChange={(e) => setAccessCode(digits(e.target.value, 4))} required aria-describedby="code-help" />
          <p id="code-help" className="peb-help">Shown on the projector screen in the hall.</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!entryNumber || pin.length !== 6 || accessCode.length !== 4}>
          {loading ? 'Checking…' : <>Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
        </Button>
      </form>
    </AuthFrame>
  );
}
