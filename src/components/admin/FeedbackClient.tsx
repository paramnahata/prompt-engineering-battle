'use client';

import { useCallback, useState } from 'react';
import { Download, MessageSquareHeart, Star } from 'lucide-react';
import { api, errorMessage, organizerLogin } from '@/lib/client/api';
import { usePolling } from '@/hooks/usePolling';
import { timeAgo } from '@/lib/client/activity';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';

interface Row {
  entryNumber: number | null; teamName: string | null; members: string[]; overall: number; system: number; management: number;
  challengeLevel: string; joinAgain: string; liked: string; suggestions: string | null; submittedAt: string;
}
interface Data { available: boolean; rows: Row[]; summary: { responses: number; checkedIn: number; overall: number | null; system: number | null; management: number | null } | null }

const LEVEL: Record<string, string> = { too_easy: 'Too easy', just_right: 'Just right', too_hard: 'Too hard' };

function Rating({ v }: { v: number }) {
  return <span className="inline-flex items-center gap-1 tabular text-white"><Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-hidden="true" />{v}</span>;
}

/** Round 1 feedback from every team, with averages and a CSV download. */
export default function FeedbackClient() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<Data>('/api/admin/feedback', { loginPath: organizerLogin('/admin/feedback') })); setError(null); }
    catch (e) { setError(errorMessage(e)); throw e; }
  }, []);
  usePolling(load, 15_000);
  const s = data?.summary;

  return (
    <>
      <PageHeader title="Feedback" description="Every team gives this after their Round 1 answers are locked. Updates every few seconds."
        actions={<a className="peb-btn-secondary" href="/api/admin/export?type=feedback" download><Download className="h-4 w-4" aria-hidden="true" />Download CSV</a>} />
      {error && <Alert tone="error" className="mb-5">{error}</Alert>}
      {data && !data.available && <Alert tone="warning" className="mb-5">Feedback storage is not set up yet: run the 0009 database update in Supabase. Until then students are not asked for feedback.</Alert>}
      {s && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Responses', `${s.responses}${s.checkedIn ? ` / ${s.checkedIn}` : ''}`], ['Overall', s.overall ?? '—'], ['System', s.system ?? '—'], ['Management', s.management ?? '—']].map(([label, value]) => (
            <div key={String(label)} className="peb-panel p-4"><div className="text-xs text-muted">{label}{label !== 'Responses' ? ' (avg of 5)' : ''}</div><div className="mt-1 font-display text-2xl font-semibold tabular text-white">{value}</div></div>
          ))}
        </div>
      )}
      <Panel title="All responses" bodyClassName="p-0">
        {!data ? <div className="p-5"><SkeletonRows /></div> : data.rows.length === 0 ? (
          <div className="p-5"><EmptyState icon={<MessageSquareHeart className="h-6 w-6" />} title="No feedback yet">Teams are asked for feedback right after their last Round 1 answer is locked.</EmptyState></div>
        ) : (
          <div className="overflow-auto">
            <table className="peb-table">
              <thead><tr><th>Entry</th><th>Team</th><th>Overall</th><th>System</th><th>Mgmt</th><th>Challenges</th><th>Again?</th><th>Liked</th><th>Suggestions</th><th>When</th></tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.entryNumber}-${i}`}>
                    <td className="tabular font-semibold">{r.entryNumber}</td>
                    <td><div className="text-white">{r.teamName || r.members.join(' & ')}</div>{r.teamName && <div className="text-xs text-muted">{r.members.join(' & ')}</div>}</td>
                    <td><Rating v={r.overall} /></td><td><Rating v={r.system} /></td><td><Rating v={r.management} /></td>
                    <td className="whitespace-nowrap">{LEVEL[r.challengeLevel] ?? r.challengeLevel}</td>
                    <td className="capitalize">{r.joinAgain}</td>
                    <td className="min-w-[14rem] max-w-md whitespace-pre-wrap text-sm text-slate-200">{r.liked}</td>
                    <td className="min-w-[14rem] max-w-md whitespace-pre-wrap text-sm text-slate-300">{r.suggestions || <span className="text-faint">—</span>}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{timeAgo(r.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
