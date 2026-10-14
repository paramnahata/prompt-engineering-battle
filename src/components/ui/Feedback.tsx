import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from './cn';

type AlertTone = 'info' | 'success' | 'warning' | 'error';
const ALERT: Record<AlertTone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-50', Icon: Info },
  success: { cls: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-50', Icon: CheckCircle2 },
  warning: { cls: 'border-amber-400/30 bg-amber-500/10 text-amber-50', Icon: AlertTriangle },
  error: { cls: 'border-rose-400/30 bg-rose-500/10 text-rose-50', Icon: XCircle },
};

export function Alert({ tone = 'info', title, children, className, action }: { tone?: AlertTone; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const { cls, Icon } = ALERT[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn('leading-6 opacity-90', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mb-3 text-slate-500">{icon}</div>}
      <div className="font-medium text-slate-200">{title}</div>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('peb-skeleton h-4', className)} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={cn('h-9', i % 2 ? 'w-[92%]' : 'w-full')} />)}
    </div>
  );
}
