'use client';

import { useEffect, useRef, useState } from 'react';

/** Rotating event access code (organizer-only). Re-syncs to server time and refetches at rotation. */
export default function AccessCodePanel({ large = false }: { large?: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rotatesAt = useRef(0);
  const offset = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let fetching = false;
    const fetchCode = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const res = await fetch('/api/access-code', { cache: 'no-store' });
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) setError('Sign in as an organizer to see the code.');
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setCode(data.code);
        rotatesAt.current = data.rotatesAt;
        offset.current = data.serverNow - Date.now();
        setError(null);
      } catch {
        if (!cancelled) setError('Reconnecting…');
      } finally {
        fetching = false;
      }
    };
    void fetchCode();
    const refetch = setInterval(fetchCode, 30_000);
    const tick = setInterval(() => {
      if (!rotatesAt.current) return;
      const remaining = Math.max(0, Math.ceil((rotatesAt.current - (Date.now() + offset.current)) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) void fetchCode();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(refetch);
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="peb-card flex flex-col items-center justify-center text-center">
      <div className="mb-2 text-xs text-muted">Event access code</div>
      <div className={`font-display font-semibold tabular tracking-[0.18em] text-white ${large ? 'text-8xl sm:text-9xl' : 'text-5xl'}`} aria-live="polite">{code ?? '····'}</div>
      <div className="mt-2 text-xs text-muted">{error ?? (secondsLeft !== null ? `Changes in ${secondsLeft}s` : 'Loading…')}</div>
    </div>
  );
}
