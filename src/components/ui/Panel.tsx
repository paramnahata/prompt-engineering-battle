import { cn } from './cn';

export function Panel({ title, description, actions, children, className, bodyClassName, id }: {
  title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode;
  children?: React.ReactNode; className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <section className={cn('peb-panel', className)} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold text-white">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, meta }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.9rem] font-semibold leading-tight text-white sm:text-[2.2rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line bg-surface/80 px-4 py-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('mt-1 font-display text-[1.75rem] font-semibold leading-none tabular',
        tone === 'good' ? 'text-emerald-200' : tone === 'warn' ? 'text-amber-200' : tone === 'bad' ? 'text-rose-200' : 'text-white')}>
        {value ?? <span className="peb-skeleton inline-block h-6 w-10 align-middle" />}
      </div>
      {hint && <div className="mt-1.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}
