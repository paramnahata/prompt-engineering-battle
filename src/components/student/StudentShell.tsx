'use client';

import Link from 'next/link';
import LogoutButton from '@/components/auth/LogoutButton';
import { BrandMark } from '@/components/layout/Brand';
import { BuiltBy, MgmLogo, SwayambhuLogo } from '@/components/layout/EventLogos';
import { ToastProvider } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';

/** Student frame: brand, entry number, optional live element (timer) and sign-out. Deliberately quiet. */
export default function StudentShell({ entryNumber, right, below, children, wide = false, nav = false }: {
  entryNumber: number | null; right?: React.ReactNode; below?: React.ReactNode; children: React.ReactNode; wide?: boolean; nav?: boolean;
}) {
  return (
    <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-violet-600 focus:px-3 focus:py-2 focus:text-white">Skip to content</a>
      <header className="sticky top-0 z-20 border-b border-line bg-background/95">
        <div className={cn('mx-auto flex h-16 items-center gap-3 px-4 sm:gap-4 sm:px-6', wide ? 'max-w-7xl' : 'max-w-5xl')}>
          <MgmLogo size="sm" />
          <BrandMark href="/student/waiting" compact />
          {nav && (
            <nav aria-label="Student" className="ml-2 hidden gap-1 sm:flex">
              <Link href="/student/waiting" className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white">Home</Link>
              <Link href="/student/results" className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white">Results</Link>
            </nav>
          )}
          <div className="flex-1" />
          {right}
          {entryNumber !== null && (
            <span className="hidden items-baseline gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 sm:flex">
              <span className="text-xs text-muted">Entry</span><span className="font-display text-base font-semibold tabular text-white">{entryNumber}</span>
            </span>
          )}
          <LogoutButton redirectTo="/student/login" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white" />
          <SwayambhuLogo size="sm" />
        </div>
        {below}
      </header>
      <main id="main" className={cn('mx-auto px-4 py-6 sm:px-6 sm:py-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</main>
      <footer className={cn('mx-auto flex justify-center border-t border-line/60 px-4 py-5 sm:px-6', wide ? 'max-w-7xl' : 'max-w-5xl')}>
        <BuiltBy />
      </footer>
    </ToastProvider>
  );
}

/** Centered status card used for paused / loading / done states. */
export function StudentCenter({ entryNumber, icon, title, children, action }: { entryNumber: number | null; icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <StudentShell entryNumber={entryNumber}>
      <section className="peb-panel mx-auto mt-[8vh] max-w-lg p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200" aria-hidden="true">{icon}</div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        <div className="mt-3 leading-7 text-slate-300" aria-live="polite">{children}</div>
        {action && <div className="mt-6">{action}</div>}
      </section>
    </StudentShell>
  );
}
