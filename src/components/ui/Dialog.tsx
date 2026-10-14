'use client';

import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Alert } from './Feedback';
import { cn } from './cn';

export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md' }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; description?: React.ReactNode;
  children?: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <RD.Content
          className={cn('fixed left-1/2 top-[6vh] z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-2xl border border-line bg-[#15151c] shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
            size === 'sm' ? 'max-w-md' : size === 'md' ? 'max-w-lg' : size === 'lg' ? 'max-w-2xl' : 'max-w-4xl')}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4">
            <div className="min-w-0">
              <RD.Title className="font-display text-lg font-semibold text-white">{title}</RD.Title>
              {description ? <RD.Description className="mt-1 text-sm text-muted">{description}</RD.Description> : <RD.Description className="sr-only">Dialog</RD.Description>}
            </div>
            <RD.Close className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line/70 px-5 py-3.5">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/**
 * Confirmation for consequential actions. When `phrase` is set, the confirm
 * button stays disabled until the exact phrase is typed (destructive actions).
 */
export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, tone = 'primary', phrase, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; children?: React.ReactNode;
  confirmLabel: string; tone?: 'primary' | 'danger'; phrase?: string; onConfirm: (typed?: string) => Promise<void> | void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setTyped(''); setError(null); setBusy(false); } }, [open]);
  const ready = !phrase || typed === phrase;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(phrase ? typed : undefined);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title={title} size="md"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => void go()} disabled={!ready} loading={busy}>{confirmLabel}</Button>
      </>}>
      <div className="space-y-4 text-sm leading-6 text-slate-300">
        {children}
        {phrase && (
          <label className="block">
            <span className="peb-label">Type <span className="font-semibold text-white">{phrase}</span> to confirm</span>
            <input className="peb-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
              onKeyDown={(e) => e.key === 'Enter' && void go()} aria-label={`Type ${phrase} to confirm`} />
          </label>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
