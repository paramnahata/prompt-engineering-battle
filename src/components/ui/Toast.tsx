'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';
import { cn } from './cn';

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const Ctx = createContext<(tone: Toast['tone'], message: string) => void>(() => {});

/** Lightweight toasts announced to screen readers; auto-dismiss after 5 s (errors 8 s). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info;
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn('pointer-events-auto flex animate-fade-in items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur',
                t.tone === 'success' ? 'border-emerald-400/30 bg-[#11231d]/95 text-emerald-50' : t.tone === 'error' ? 'border-rose-400/30 bg-[#2a1219]/95 text-rose-50' : 'border-line bg-raised/95 text-slate-100')}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="leading-5">{t.message}</span>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => {
  const push = useContext(Ctx);
  return { success: (m: string) => push('success', m), error: (m: string) => push('error', m), info: (m: string) => push('info', m) };
};
