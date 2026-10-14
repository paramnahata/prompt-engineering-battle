import Link from 'next/link';

/** Wordmark: a prompt caret inside a violet→blue tile. */
export function BrandMark({ sub, href = '/', compact = false }: { sub?: string; href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-lg" aria-label="Prompt Engineering Battle home">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-[9px] bg-peb-gradient shadow-glow" aria-hidden="true">
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l5 4-5 4" /><path d="M11 15h5" />
        </svg>
      </span>
      <span className={compact ? 'hidden leading-tight sm:block' : 'leading-tight'}>
        <span className="block font-display text-[0.95rem] font-semibold text-white" style={{ fontVariationSettings: "'wdth' 88" }}>Prompt Battle</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </Link>
  );
}
