'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function OrganizerLoginForm({ next }: { next: string }) {
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Sign-in failed.');
        setLoading(false);
        return;
      }
      // `next` is already sanitised server-side to a same-site path.
      window.location.replace(next);
    } catch {
      setError('Unable to sign in. Check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="peb-card flex w-full max-w-sm flex-col gap-4" noValidate>
        <Link href="/" className="-mt-1 text-xs text-slate-400 hover:text-white">← Home</Link>
        <h1 className="text-center text-xl font-semibold">Organizer Login</h1>
        <p className="-mt-2 text-center text-xs text-muted">Admin, Registration Desk and Judge accounts sign in here.</p>
        <label className="text-xs font-semibold text-slate-300" htmlFor="org-email">Email</label>
        <input id="org-email" className="-mt-2 w-full rounded-lg border border-border bg-surface p-2.5 focus:outline-none focus:ring-1 focus:ring-accent" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="text-xs font-semibold text-slate-300" htmlFor="org-password">Password</label>
        <input id="org-password" className="-mt-2 w-full rounded-lg border border-border bg-surface p-2.5 focus:outline-none focus:ring-1 focus:ring-accent" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button className="peb-btn-primary" disabled={loading || !email || !password}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
