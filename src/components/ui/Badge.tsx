import { cn } from './cn';

export type Tone = 'neutral' | 'violet' | 'blue' | 'green' | 'amber' | 'red';
const TONE: Record<Tone, string> = {
  neutral: 'border-slate-700 bg-slate-800/60 text-slate-200',
  violet: 'border-violet-400/30 bg-violet-500/15 text-violet-100',
  blue: 'border-cyan-400/30 bg-cyan-500/15 text-cyan-100',
  green: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
  amber: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
  red: 'border-rose-400/30 bg-rose-500/15 text-rose-100',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400', violet: 'bg-violet-300', blue: 'bg-cyan-300', green: 'bg-emerald-300', amber: 'bg-amber-300', red: 'bg-rose-300',
};

export function Badge({ tone = 'neutral', dot = false, pulse = false, className, children }: { tone?: Tone; dot?: boolean; pulse?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium', TONE[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone], pulse && 'animate-pulse-glow')} aria-hidden="true" />}
      {children}
    </span>
  );
}

const ROUND: Record<string, { tone: Tone; label: string }> = {
  not_started: { tone: 'neutral', label: 'Not started' },
  running: { tone: 'green', label: 'Live' },
  paused: { tone: 'amber', label: 'Paused' },
  ended: { tone: 'violet', label: 'Ended' },
};

export function RoundStatusBadge({ status }: { status: string | null | undefined }) {
  const s = ROUND[status ?? ''] ?? { tone: 'neutral' as Tone, label: 'Loading…' };
  return <Badge tone={s.tone} dot pulse={status === 'running'}>{s.label}</Badge>;
}
