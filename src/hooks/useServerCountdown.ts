'use client';

import { useEffect, useRef, useState } from 'react';

interface Options {
  /** ISO timestamp string from the server marking when the timer ends. */
  endAtIso: string | null;
  /** ISO timestamp string the server says "now" was, from the same response. */
  serverNowIso: string | null;
  /** Called once the countdown reaches zero (fires at most once). */
  onExpire?: () => void;
  /** Re-fetch this often to catch admin overrides / pause / resume. */
  resyncIntervalMs?: number;
  /** Called on the resync interval to pull a fresh endAt/serverNow pair. */
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
  const offsetRef = useRef(0); // serverNow - Date.now(), ms
  const endRef = useRef<number | null>(null);
  const firedExpireRef = useRef(false);

  useEffect(() => {
    if (!endAtIso || !serverNowIso) return;
    offsetRef.current = new Date(serverNowIso).getTime() - Date.now();
    endRef.current = new Date(endAtIso).getTime();
    firedExpireRef.current = false;
  }, [endAtIso, serverNowIso]);

  useEffect(() => {
    const tick = () => {
      if (endRef.current == null) return;
      const estServerNow = Date.now() + offsetRef.current;
      const remaining = Math.max(0, Math.floor((endRef.current - estServerNow) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && !firedExpireRef.current) {
        firedExpireRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [onExpire]);

  // Periodic resync so admin overrides (extend/pause) reach the client
  // without the participant needing to refresh.
  useEffect(() => {
    if (!onResync) return;
    const id = setInterval(async () => {
      const fresh = await onResync();
      if (fresh) {
        offsetRef.current = new Date(fresh.serverNowIso).getTime() - Date.now();
        endRef.current = new Date(fresh.endAtIso).getTime();
      }
    }, resyncIntervalMs);
    return () => clearInterval(id);
  }, [onResync, resyncIntervalMs]);

  // Also resync immediately on tab refocus / reconnect.
  useEffect(() => {
    if (!onResync) return;
    const handler = async () => {
      if (document.visibilityState !== 'visible') return;
      const fresh = await onResync();
      if (fresh) {
        offsetRef.current = new Date(fresh.serverNowIso).getTime() - Date.now();
        endRef.current = new Date(fresh.endAtIso).getTime();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [onResync]);

  return secondsLeft;
}
