'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { RoundStatusBadge } from '@/components/ui/Badge';

type R = { status: string; round_end_at: string | null } | null;

function Pill({ label, round, serverNow }: { label: string; round: R; serverNow: string | null }) {
  const left = useServerCountdown({ endAtIso: round?.status === 'running' ? round.round_end_at : null, serverNowIso: serverNow });
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-background/60 px-2.5 py-1.5 text-xs">
      <span className="text-muted">{label}</span>
      <RoundStatusBadge status={round?.status} />
      {left !== null && <span className="font-display text-sm font-semibold tabular text-white">{formatMMSS(left)}</span>}
    </div>
  );
}

/** Live status of both rounds in the organizer top bar (every organizer role may read it). */
export default function RoundPulse() {
  const [data, setData] = useState<{ round: R; round2: R; serverNow: string } | null>(null);
  const load = useCallback(async () => {
    const res = await fetch('/api/display/stats', { cache: 'no-store' });
    if (!res.ok) throw new Error('status');
    setData(await res.json());
  }, []);
  usePolling(load, 10_000);
  // Pages that change a round announce it so the top bar updates immediately.
  useEffect(() => {
    const h = () => void load().catch(() => {});
    window.addEventListener('peb:rounds-changed', h);
    return () => window.removeEventListener('peb:rounds-changed', h);
  }, [load]);
  return (
    <div className="hidden items-center gap-2 md:flex" aria-live="off">
      <Pill label="Round 1" round={data?.round ?? null} serverNow={data?.serverNow ?? null} />
      <Pill label="Round 2" round={data?.round2 ?? null} serverNow={data?.serverNow ?? null} />
    </div>
  );
}
