import Image from 'next/image';
import { cn } from '@/components/ui/cn';

/**
 * Event logos, transparent (no white box). Each has a variant for dark
 * surfaces (MGM lightened; SWAYAMBHU with a thin white outline) and one for
 * light surfaces. Placement: MGM University top-left → jnec.org,
 * SWAYAMBHU 2026 top-right → swayambhu.jnec.org. Shown once per page.
 */
type Tone = 'dark' | 'light';
const HEIGHT = { sm: 'h-10 sm:h-11', md: 'h-14 sm:h-16', lg: 'h-20', xl: 'h-24 2xl:h-28' } as const;
type Size = keyof typeof HEIGHT;

export function MgmLogo({ tone = 'dark', size = 'sm', className }: { tone?: Tone; size?: Size; className?: string }) {
  return (
    <a href="https://www.jnec.org/" target="_blank" rel="noopener noreferrer" aria-label="JNEC, MGM University (opens in a new tab)"
      className={cn('inline-flex shrink-0 items-center rounded-md transition-opacity hover:opacity-85', className)}>
      <Image src={tone === 'dark' ? '/brand/mgmu-dark.webp' : '/brand/mgmu.webp'} alt="MGM University" width={480} height={274}
        unoptimized priority className={cn('w-auto', HEIGHT[size])} />
    </a>
  );
}

export function SwayambhuLogo({ tone = 'dark', size = 'sm', className }: { tone?: Tone; size?: Size; className?: string }) {
  return (
    <a href="https://swayambhu.jnec.org/" target="_blank" rel="noopener noreferrer" aria-label="SWAYAMBHU 2026 (opens in a new tab)"
      className={cn('inline-flex shrink-0 items-center rounded-md transition-opacity hover:opacity-85', className)}>
      <Image src={tone === 'dark' ? '/brand/swayambhu-dark.webp' : '/brand/swayambhu.webp'} alt="SWAYAMBHU 2026" width={480} height={447}
        unoptimized priority className={cn('w-auto', HEIGHT[size])} />
    </a>
  );
}

/** "Built under JNEC, for JNEC" — the text itself links to the builder's site (no URL shown). */
export function BuiltBy({ className }: { className?: string }) {
  return (
    <a href="https://paramnahata.com" target="_blank" rel="noopener noreferrer"
      className={cn('text-sm text-faint underline-offset-4 transition-colors hover:text-violet-200 hover:underline', className)}>
      Built under JNEC, for JNEC
    </a>
  );
}
