'use client';

import { useState } from 'react';
import AuthFrame from '@/components/auth/AuthFrame';
import { Alert } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';

export default function OrganizerLoginForm({ next, setupIssue }: { next: string; setupIssue?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/organizer/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Sign-in failed.');
        setLoading(false);
        return;
      }
      // `next` is sanitised server-side to a same-site path; otherwise go to the role's home.
      window.location.replace(next || body.home || '/organizer/hub');
    } catch {
      setError('Unable to sign in. Check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <AuthFrame aside={
      <div>
        <h1 className="font-display text-[3.2rem] font-semibold leading-[1.04] text-white" style={{ fontVariationSettings: "'wdth' 84" }}>Run the battle from one console.</h1>
        <p className="mt-5 max-w-md text-lg leading-8 text-slate-300">Admins, registration desk volunteers and judges sign in here. Each role sees only the tools it needs.</p>
      </div>
    }>
      <h2 className="text-2xl font-semibold text-white">Organizer sign in</h2>
      <p className="mt-1 text-sm text-muted">Use the email and password your admin gave you.</p>
      {setupIssue && <Alert tone="error" className="mt-5">{setupIssue}</Alert>}
      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <div>
          <label className="peb-label" htmlFor="org-email">Email</label>
          <input id="org-email" className="peb-input py-3" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div>
          <label className="peb-label" htmlFor="org-password">Password</label>
          <input id="org-password" className="peb-input py-3" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!email || !password}>{loading ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </AuthFrame>
  );
}
