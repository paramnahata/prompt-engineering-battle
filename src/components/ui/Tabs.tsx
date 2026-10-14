'use client';

import * as RT from '@radix-ui/react-tabs';
import { cn } from './cn';

export const Tabs = RT.Root;
export const TabsContent = RT.Content;

export function TabsList({ items, className }: { items: { value: string; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <RT.List className={cn('mb-5 flex gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((i) => (
        <RT.Trigger key={i.value} value={i.value}
          className="relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:text-slate-200 data-[state=active]:border-violet-400 data-[state=active]:text-white">
          {i.label}
          {i.count !== undefined && <span className="rounded-full bg-slate-800 px-1.5 text-xs tabular text-slate-300">{i.count}</span>}
        </RT.Trigger>
      ))}
    </RT.List>
  );
}
