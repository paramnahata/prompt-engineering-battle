'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Gauge, ClipboardCheck, Users, Swords, Library, Trophy, Gavel, Medal, Megaphone, MonitorPlay, Sparkles, KeyRound, Settings, Menu, X, MessageSquareHeart,
} from 'lucide-react';
import type { NavGroup } from './nav';
import { cn } from '@/components/ui/cn';
import LogoutButton from '@/components/auth/LogoutButton';
import { BrandMark } from './Brand';

const ICONS: Record<string, typeof Gauge> = {
  gauge: Gauge, desk: ClipboardCheck, users: Users, swords: Swords, library: Library, trophy: Trophy, gavel: Gavel,
  podium: Medal, megaphone: Megaphone, monitor: MonitorPlay, sparkles: Sparkles, key: KeyRound, settings: Settings, feedback: MessageSquareHeart,
};

function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Organizer" className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-3 pb-1.5 text-xs font-medium text-faint">{g.label}</div>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Gauge;
              const active = pathname === item.href || (item.href !== '/admin/dashboard' && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link href={item.href} prefetch={false} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                    className={cn('group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      active ? 'bg-violet-500/[0.14] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100')}>
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-violet-300' : 'text-slate-500 group-hover:text-slate-300')} aria-hidden="true" />
                    {item.label}
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-300" aria-hidden="true" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Identity({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-background/50 p-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-sm font-semibold text-violet-100" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-100">{name}</div>
        <div className="text-xs capitalize text-muted">{role}</div>
      </div>
      <LogoutButton className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-white" />
    </div>
  );
}

export default function OrganizerNav({ groups, name, role }: { groups: NavGroup[]; name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-[#111117]/95 lg:flex">
        <div className="px-5 pb-4 pt-5"><BrandMark sub="Organizer console" /></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"><NavLinks groups={groups} /></div>
        <div className="border-t border-line p-3"><Identity name={name} role={role} /></div>
      </aside>

      <div className="flex items-center gap-3 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line p-2 text-slate-300" aria-label="Open navigation" aria-expanded={open}>
          <Menu className="h-5 w-5" />
        </button>
        <BrandMark />
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-fade-in flex-col border-r border-line bg-[#111117]">
            <div className="flex items-center justify-between px-5 pb-4 pt-5">
              <BrandMark sub="Organizer console" />
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5" aria-label="Close navigation"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"><NavLinks groups={groups} onNavigate={() => setOpen(false)} /></div>
            <div className="border-t border-line p-3"><Identity name={name} role={role} /></div>
          </div>
        </div>
      )}
    </>
  );
}
