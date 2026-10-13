'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `fn` every `intervalMs` (with ±15% jitter so 200 clients don't
 * synchronise), pauses while the tab is hidden, and backs off exponentially
 * (up to 4x) while `fn` throws. Always cleans up on unmount.
 */
export function usePolling(fn: () => Promise<unknown>, intervalMs: number, options: { enabled?: boolean; runImmediately?: boolean; pauseWhenHidden?: boolean } = {}) {
  const { enabled = true, runImmediately = true, pauseWhenHidden = true } = options;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let running = false;

    const schedule = () => {
      if (cancelled) return;
      const factor = Math.min(4, 2 ** failures);
      const jitter = 0.85 + Math.random() * 0.3;
      timer = setTimeout(tick, intervalMs * factor * jitter);
    };
    const tick = async () => {
      if (cancelled) return;
      if (pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      if (running) return schedule();
      running = true;
      try {
        await fnRef.current();
        failures = 0;
      } catch {
        failures = Math.min(failures + 1, 4);
      } finally {
        running = false;
        schedule();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !running) {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };

    if (runImmediately) void tick();
    else schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, runImmediately, pauseWhenHidden]);
}
