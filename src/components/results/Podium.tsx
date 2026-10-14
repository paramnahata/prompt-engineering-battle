import { Trophy, Medal } from 'lucide-react';
import { cn } from '@/components/ui/cn';

export interface Winner { rank: number; entryNumber: number | null; teamName: string | null; members: string[]; score?: number | null; you?: boolean }

const PLACE: Record<number, { label: string; ring: string; text: string; height: string }> = {
  1: { label: '1st place', ring: 'border-amber-300/60 bg-amber-400/[0.08]', text: 'text-amber-200', height: 'sm:min-h-[15rem]' },
  2: { label: '2nd place', ring: 'border-slate-300/40 bg-slate-300/[0.05]', text: 'text-slate-200', height: 'sm:min-h-[12.5rem]' },
  3: { label: '3rd place', ring: 'border-orange-400/40 bg-orange-500/[0.06]', text: 'text-orange-200', height: 'sm:min-h-[11rem]' },
};

/** Top-3 podium. Teams that tie share a place (both are shown). Order on wide screens: 2 · 1 · 3. */
export function Podium({ winners, size = 'md', showScore = true }: { winners: Winner[]; size?: 'md' | 'lg'; showScore?: boolean }) {
  const top = winners.filter((w) => w.rank >= 1 && w.rank <= 3);
  if (!top.length) return null;
  const places = [2, 1, 3].filter((p) => top.some((w) => w.rank === p));
  const lg = size === 'lg';
  return (
    <div className={cn('grid items-end gap-3', places.length === 3 ? 'sm:grid-cols-3' : places.length === 2 ? 'sm:grid-cols-2' : '')}>
      {places.map((p) => {
        const s = PLACE[p]!;
        const teams = top.filter((w) => w.rank === p);
        return (
          <div key={p} className={cn('flex flex-col justify-end rounded-2xl border p-4 text-center', s.ring, s.height, p === 1 ? 'order-first sm:order-none' : '')}>
            <div className={cn('mx-auto mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em]', s.text)}>
              {p === 1 ? <Trophy className={lg ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" /> : <Medal className={lg ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />}{s.label}{teams.length > 1 ? ' (tie)' : ''}
            </div>
            {teams.map((w) => (
              <div key={`${w.entryNumber}-${w.rank}`} className={cn('mt-1', w.you && 'rounded-lg ring-1 ring-violet-400/60')}>
                <div className={cn('font-display font-semibold text-white', lg ? 'text-4xl' : 'text-2xl')}>{w.teamName || w.members.join(' & ') || `Entry ${w.entryNumber}`}</div>
                {w.teamName && w.members.length > 0 && <div className={cn('mt-0.5 text-muted', lg ? 'text-base' : 'text-xs')}>{w.members.join(' · ')}</div>}
                <div className={cn('mt-1 tabular text-slate-300', lg ? 'text-lg' : 'text-sm')}>
                  #{w.entryNumber}{showScore && w.score !== null && w.score !== undefined ? <> · <span className="font-semibold text-white">{Number(w.score).toFixed(1)}</span></> : null}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
