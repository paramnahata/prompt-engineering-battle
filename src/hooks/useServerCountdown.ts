'use client';

import { useEffect, useRef, useState } from 'react';

interface Options {
  endAtIso: string | null;
  serverNowIso: string | null;
  onExpire?: () => void;
  resyncIntervalMs?: number;
  onResync?: () => Promise<{ endAtIso: string; serverNowIso: string } | null>;
}

export function useServerCountdown({
  endAtIso,
  serverNowIso,
  onExpire,
  resyncIntervalMs = 25_000,
  onResync,
}: Options) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const offsetRef = useRef(0);
  const endRef = useRef<number | null>(null);
  const onExpireRef = useRef(onExpire);
  const firedEndRef = useRef<string | null>(null);
  const activeEndRef = useRef<string | null>(null);

  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  // Reset the displayed value synchronously when a new challenge is selected.
  // This prevents the previous challenge's expired timestamp advancing the next one.
  useEffect(() => {
    if (!endAtIso || !serverNowIso) {
      endRef.current = null;
      activeEndRef.current = null;
      setSecondsLeft(null);
      return;
    }
    const end = new Date(endAtIso).getTime();
    const serverNow = new Date(serverNowIso).getTime();
    if (!Number.isFinite(end) || !Number.isFinite(serverNow)) {
      endRef.current = null;
      setSecondsLeft(null);
      return;
    }
    activeEndRef.current = endAtIso;
    endRef.current = end;
    offsetRef.current = serverNow - Date.now();
    firedEndRef.current = null;
    setSecondsLeft(Math.max(0, Math.ceil((end - serverNow) / 1000)));
  }, [endAtIso, serverNowIso]);

  useEffect(() => {
    if (!endAtIso || !serverNowIso) return;
    const tick = () => {
      if (activeEndRef.current !== endAtIso || endRef.current == null) return;
      const remainingMs = endRef.current - (Date.now() + offsetRef.current);
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsLeft((previous) => previous === remaining ? previous : remaining);
      if (remainingMs <= 0 && firedEndRef.current !== endAtIso) {
        firedEndRef.current = endAtIso;
        onExpireRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endAtIso, serverNowIso]);

  useEffect(() => {
    if (!onResync) return;
    let cancelled = false;
    const resync = async () => {
      try {
        const fresh = await onResync();
        if (cancelled || !fresh) return;
        const end = new Date(fresh.endAtIso).getTime();
        const serverNow = new Date(fresh.serverNowIso).getTime();
        if (!Number.isFinite(end) || !Number.isFinite(serverNow)) return;
        offsetRef.current = serverNow - Date.now();
        endRef.current = end;
        activeEndRef.current = fresh.endAtIso;
        if (firedEndRef.current !== fresh.endAtIso) setSecondsLeft(Math.max(0, Math.ceil((end - serverNow) / 1000)));
      } catch {
        // Keep the last server-synced countdown during temporary network failures.
      }
    };
    const id = setInterval(() => { void resync(); }, resyncIntervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onResync, resyncIntervalMs]);

  return secondsLeft;
}
