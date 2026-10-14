'use client';

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { timeAgo } from '@/lib/client/activity';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';

const LOGIN = organizerLogin('/admin/announcements');
type Audience = 'all' | 'checked_in' | 'round2' | 'entries';
const AUDIENCES: { value: Audience; label: string; help: string; tone: Tone }[] = [
  { value: 'all', label: 'Everyone', help: 'All teams, and the projector screen.', tone: 'violet' },
  { value: 'checked_in', label: 'Checked-in teams', help: 'Only teams marked present at the desk.', tone: 'blue' },
  { value: 'round2', label: 'Round 2 finalists', help: 'Only teams selected for the final.', tone: 'amber' },
  { value: 'entries', label: 'Specific teams', help: 'Only the entry numbers you list.', tone: 'neutral' },
];
interface Ann { id: string; title: string | null; message: string; audience: Audience; active: boolean; created_at: string; author: string | null; entryNumbers: number[] }

export default function AnnouncementsClient() {
  const toast = useToast();
  const [items, setItems] = useState<Ann[] | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [numbers, setNumbers] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Ann | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setItems((await api<{ announcements: Ann[] }>('/api/admin/announcements', { loginPath: LOGIN })).announcements), []);
  useEffect(() => { void load().catch((e) => setError(errorMessage(e))); }, [load]);
  const parsed = numbers.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const send = async () => {
    setSending(true);
    try {
      await api('/api/admin/announcements', { method: 'POST', body: { title: title.trim() || undefined, message: message.trim(), audience, entryNumbers: audience === 'entries' ? parsed : undefined }, loginPath: LOGIN });
      toast.success('Announcement published.');
      setTitle(''); setMessage(''); setNumbers('');
      await load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setSending(false); }
  };
  const toggle = async (a: Ann) => {
    try { await api('/api/admin/announcements', { method: 'PATCH', body: { id: a.id, active: !a.active }, loginPath: LOGIN }); await load(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const now = Date.now();
  return (
    <div>
      <PageHeader title="Announcements" description="Messages appear on team dashboards within a few seconds. Round start, pause and end messages are posted automatically." />
      {error && <Alert tone="error" className="mb-5">{error}</Alert>}
      <div className="grid gap-5 lg:grid-cols-[26rem_1fr]">
        <Panel title="New announcement">
          <div className="space-y-4">
            <Field id="a-title" label="Title (optional)"><input id="a-title" className="peb-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field id="a-msg" label="Message" help={`${message.length}/1000`}><textarea id="a-msg" rows={4} className="peb-input" value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} /></Field>
            <fieldset>
              <legend className="peb-label">Who should see it?</legend>
              <div className="space-y-1.5">
                {AUDIENCES.map((a) => (
                  <label key={a.value} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm', audience === a.value ? 'border-violet-400/50 bg-violet-500/10' : 'border-line hover:border-slate-600')}>
                    <input type="radio" name="audience" className="mt-1 accent-violet-500" checked={audience === a.value} onChange={() => setAudience(a.value)} />
                    <span><span className="font-medium text-slate-100">{a.label}</span><span className="block text-xs text-muted">{a.help}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {audience === 'entries' && <Field id="a-entries" label="Entry numbers" help="Separate with commas or spaces."><input id="a-entries" className="peb-input" inputMode="numeric" value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="4, 18, 112" /></Field>}
            <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={sending} disabled={!message.trim() || (audience === 'entries' && !parsed.length)} onClick={() => void send()}>Publish announcement</Button>
          </div>
        </Panel>
        <Panel title="Published" description="Hide an announcement to take it off student screens without deleting it." bodyClassName="p-0">
          {!items ? <div className="p-5"><SkeletonRows /></div> : items.length === 0 ? (
            <div className="p-5"><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements yet">Write the first one on the left.</EmptyState></div>
          ) : (
            <ul className="divide-y divide-line/60">
              {items.map((a) => {
                const aud = AUDIENCES.find((x) => x.value === a.audience) ?? AUDIENCES[0]!;
                return (
                  <li key={a.id} className={cn('flex flex-wrap items-start gap-3 px-5 py-3.5', !a.active && 'opacity-55')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.title && <span className="font-medium text-white">{a.title}</span>}
                        <Badge tone={aud.tone}>{aud.label}{a.audience === 'entries' ? `: ${a.entryNumbers.join(', ')}` : ''}</Badge>
                        {!a.active && <Badge>Hidden</Badge>}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{a.message}</p>
                      <p className="mt-1 text-xs text-faint">{a.author ?? 'Automatic'} · {timeAgo(a.created_at, now)}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void toggle(a)}>{a.active ? 'Hide' : 'Show again'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(a)}>Delete</Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      <ConfirmDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)} title="Delete this announcement?" tone="danger" confirmLabel="Delete"
        onConfirm={async () => { await api('/api/admin/announcements', { method: 'DELETE', body: { id: confirmDelete!.id }, loginPath: LOGIN }); toast.success('Announcement deleted.'); await load(); }}>
        <p>It disappears from every screen. The deletion is recorded in the audit log.</p>
      </ConfirmDialog>
    </div>
  );
}
