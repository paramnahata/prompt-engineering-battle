'use client';

import { useEffect, useState } from 'react';

export default function AccessCodePanel() {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let rotatesAtMs = 0;
    let offsetMs = 0;

    const fetchCode = async () => {
      try {
        const res = await fetch('/api/access-code');
        const data = await res.json();
        setCode(data.code);
        rotatesAtMs = data.rotatesAt;
        offsetMs = new Date(data.serverNow).getTime() - Date.now();
      } catch {
        // keep showing the last known code
      }
    };

    fetchCode();
    const refetchInterval = setInterval(fetchCode, 15_000);
    const tickInterval = setInterval(() => {
      if (!rotatesAtMs) return;
      const estServerNow = Date.now() + offsetMs;
      const remaining = Math.max(0, Math.round((rotatesAtMs - estServerNow) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) fetchCode();
    }, 1000);

    return () => {
      clearInterval(refetchInterval);
      clearInterval(tickInterval);
    };
  }, []);

  return (
    <div className="peb-card text-center">
      <div className="text-xs text-muted uppercase tracking-widest mb-2">Event Access Code</div>
      <div className="text-5xl font-mono font-bold tracking-[0.3em] text-accent-cyan">{code ?? '····'}</div>
      <div className="text-xs text-muted mt-2">
        {secondsLeft !== null ? `Changes in ${secondsLeft}s` : 'Loading…'}
      </div>
    </div>
  );
}
