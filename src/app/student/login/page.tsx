'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StudentLoginPage() {
  const router = useRouter();
  const [entryCode, setEntryCode] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/student/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryCode, accessCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Login failed');
      }
      router.push('/student/waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="peb-card w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-center">Student Login</h1>
        <div>
          <label className="text-sm text-muted">Entry ID</label>
          <input
            className="w-full bg-surface border border-border rounded-lg p-2 mt-1 focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="ENTRY-001"
            value={entryCode}
            onChange={(e) => setEntryCode(e.target.value)}
            required
          suppressHydrationWarning
          />
        </div>
        <div>
          <label className="text-sm text-muted">Event Access Code</label>
          <input
            className="w-full bg-surface border border-border rounded-lg p-2 mt-1 focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="6-digit code shown on screen"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            required
          suppressHydrationWarning
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="peb-btn-primary" disabled={loading}>
          {loading ? 'Signing in…' : 'Enter'}
        </button>
      </form>
    </main>
  );
}
