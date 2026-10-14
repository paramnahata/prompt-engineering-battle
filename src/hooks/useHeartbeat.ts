'use client';

import { useEffect } from 'react';

/**
 * Keeps the student's session marked as alive for the organizer's Live
 * Participants panel. Sends visibility so a hidden tab shows as "idle".
 * On 401 (logged out / released / expired) calls onSessionEnded.
 */
export function useHeartbeat(onSessionEnded: () => void, intervalMs = 20_000) {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const beat = async () => {
      try {
        const res = await fetch('/api/student/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visible: document.visibilityState === 'visible' }),
          cache: 'no-store',
          keepalive: true,
        });
        if (res.status === 401 && !cancelled) onSessionEnded();
      } catch {
        // Offline: the panel will show idle/offline, which is accurate.
      }
    };
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => { await beat(); schedule(); }, intervalMs * (0.85 + Math.random() * 0.3));
    };
    const onVisibility = () => { void beat(); };

    void beat();
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
