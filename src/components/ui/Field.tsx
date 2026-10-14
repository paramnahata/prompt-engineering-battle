import { cn } from './cn';

/** Label + control + help/error, wired for screen readers via the control's id. */
export function Field({ id, label, help, error, children, className }: { id: string; label: React.ReactNode; help?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="peb-label">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="mt-1.5 text-xs text-rose-300">{error}</p> : help ? <p id={`${id}-help`} className="peb-help">{help}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean; id: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-slate-100">{label}</label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50',
          checked ? 'border-violet-400/60 bg-violet-500/70' : 'border-line bg-slate-800')}>
        <span className={cn('absolute left-[3px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[19px]' : 'translate-x-0')} />
      </button>
    </div>
  );
}
