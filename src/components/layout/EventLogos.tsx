import Image from 'next/image';
import { cn } from '@/components/ui/cn';

/**
 * MGM University and SWAYAMBHU 2026 logos. Both artworks have white
 * backgrounds, so they sit on white tiles that read well on dark and light
 * themes. Small WebP files (~11 KB and ~21 KB), served as-is (no image
 * optimizer round-trip) and cached by the browser.
 */
export function EventLogos({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const h = { sm: 'h-9', md: 'h-12', lg: 'h-16', xl: 'h-24' }[size];
  const pad = size === 'xl' ? 'p-2.5' : size === 'sm' ? 'p-1' : 'p-1.5';
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className={cn('flex items-center rounded-lg bg-white shadow-sm', pad)}>
        <Image src="/brand/mgmu.webp" alt="MGM University" width={360} height={205} unoptimized priority className={cn('w-auto', h)} />
      </span>
      <span className={cn('flex items-center rounded-lg bg-white shadow-sm', pad)}>
        <Image src="/brand/swayambhu.webp" alt="SWAYAMBHU 2026" width={360} height={335} unoptimized priority className={cn('w-auto', h)} />
      </span>
    </div>
  );
}

/** "Built under JNEC, for JNEC" credit line with a link to the builder's site. */
export function BuiltBy({ className }: { className?: string }) {
  return (
    <p className={cn('text-sm text-faint', className)}>
      Built under JNEC, for JNEC ·{' '}
      <a href="https://paramnahata.com" target="_blank" rel="noopener noreferrer" className="text-violet-300 underline-offset-4 hover:text-violet-200 hover:underline">paramnahata.com</a>
    </p>
  );
}
