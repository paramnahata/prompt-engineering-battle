'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function OrganizerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get('next') ?? '/organizer/hub';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/organizer/hub';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        setError(body.error ?? 'Login failed');
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Unable to sign in. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="peb-card w-full max-w-sm flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-center">Organizer Login</h1>
      <p className="text-xs text-muted text-center -mt-2">Admin, Registration Desk, and Judge accounts all sign in here.</p>
      <input className="w-full bg-surface border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-accent" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="w-full bg-surface border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-accent" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="peb-btn-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

export default function OrganizerLoginFormPage() {
  return <main className="min-h-screen flex items-center justify-center p-6"><Suspense fallback={<p className="text-sm text-muted">Loading login…</p>}><OrganizerLoginForm /></Suspense></main>;
}