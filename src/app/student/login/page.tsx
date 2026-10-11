'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Swords } from 'lucide-react';

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
        body: JSON.stringify({ entryCode: entryCode.trim(), accessCode: accessCode.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Login failed. Check your details and try again.');
      }
      router.push('/student/waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-5 sm:p-8">
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-violet-600/20 blur-[100px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-[100px]" />
      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 shadow-2xl shadow-black/30 backdrop-blur-xl md:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden flex-col justify-between border-r border-white/10 bg-gradient-to-br from-violet-950/70 via-slate-950/30 to-cyan-950/40 p-8 md:flex lg:p-10">
          <Link href="/" className="inline-flex w-fit items-center gap-2 text-xs font-semibold text-slate-400 transition hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to home</Link>
          <div>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-300/10"><Swords className="h-7 w-7 text-cyan-200" /></span>
            <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-300">Participant access</p>
            <h1 className="mt-3 text-4xl font-black leading-tight">Enter the arena.</h1>
            <p className="mt-4 text-sm leading-7 text-slate-400">Four challenges. One sharp mind. Build the prompt that gets the best result.</p>
          </div>
          <p className="text-xs text-slate-600">Your challenge progress is tied to your Entry ID.</p>
        </section>

        <section className="p-6 sm:p-9 lg:p-11">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 transition hover:text-white md:hidden"><ArrowLeft className="h-4 w-4" /> Back to home</Link>
          <div className="mb-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07]"><KeyRound className="h-5 w-5 text-cyan-200" /></div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-violet-300">Secure sign in</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">Student login</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">Use the Entry ID provided by the registration desk and the current access code shown by the organizer.</p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="entryCode" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Entry ID</label>
              <input
                id="entryCode"
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 p-3.5 text-sm placeholder:text-slate-600 focus:border-violet-300/50 focus:outline-none focus:ring-2 focus:ring-violet-400/10"
                placeholder="Enter your number (e.g. 1)"
                autoCapitalize="characters"
                autoComplete="username"
                value={entryCode}
                onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                required
              />
            </div>
            <div>
              <label htmlFor="accessCode" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Event access code</label>
              <input
                id="accessCode"
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 p-3.5 text-sm placeholder:text-slate-600 focus:border-cyan-300/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/10"
                placeholder="4-digit code"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                autoComplete="one-time-code"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required
              />
            </div>
            {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
            <button className="peb-btn-primary mt-1 w-full" disabled={loading}>
              {loading ? 'Verifying access…' : 'Enter the arena'}
            </button>
          </form>
          <p className="mt-6 text-center text-xs leading-5 text-slate-600">Having trouble? Ask the event registration desk to verify your Entry ID and access code.</p>
        </section>
      </div>
    </main>
  );
}
