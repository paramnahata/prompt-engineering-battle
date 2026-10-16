'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowUpRight, CircleAlert, Activity, TriangleAlert } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { formatMMSS } from '@/lib/timer';
import { api, organizerLogin } from '@/lib/client/api';
import { activityLabel, timeAgo } from '@/lib/client/activity';
import { PageHeader, Panel, Stat } from '@/components/ui/Panel';
import { Badge, RoundStatusBadge } from '@/components/ui/Badge';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { cn } from '@/components/ui/cn';

type Round = { status: string; round_start_at: string | null; round_end_at: string | null; paused_at: string | null } | null;
interface Overview {
  serverNow: string;
  rounds: { round1: Round; round2: Round };
  participants: { entries: number; members: number; present: number; disqualified: number };
  logins: { online: number; idle: number; offline: number };
  round1: { answers: number; submitted: number; evalPending: number; evalFailed: number; evaluated: number; results: number; ready: boolean };
  round2: { finalists: number; submitted: number; configured: boolean; ready: boolean };
  results: { round1Published: boolean; finalComputed: number; finalPublished: boolean };
  setup: { level: 'error' | 'warning'; message: string; href: string }[];
  activity: { id: string; action: string; at: string; by: string; entry: number | null }[];
}

function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted"><span>{label}</span><span className="tabular text-slate-200">{value} / {max}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-peb-gradient transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RoundCard({ title, href, round, serverNow, children, ready, readyText }: { title: string; href: string; round: Round; serverNow: string | null; children: React.ReactNode; ready: boolean; readyText: string }) {
  const left = useServerCountdown({ endAtIso: round?.status === 'running' ? round.round_end_at : null, serverNowIso: serverNow });
  return (
    <section className="peb-panel flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <RoundStatusBadge status={round?.status} />
            {round?.status === 'not_started' && <Badge tone={ready ? 'green' : 'amber'}>{ready ? 'Ready to start' : readyText}</Badge>}
          </div>
        </div>
        {left !== null && (
          <div className="text-right">
            <div className="font-display text-3xl font-semibold tabular text-white">{formatMMSS(left)}</div>
            <div className="text-xs text-muted">remaining</div>
          </div>
        )}
      </div>
      <div className="mt-5 flex-1 space-y-4">{children}</div>
      <Link href={href} className="peb-btn-secondary mt-5 self-start">Open {title} <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
    </section>
  );
}

export default function OverviewClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Overview>('/api/admin/overview', { loginPath: organizerLogin('/admin/dashboard') }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the overview.');
      throw e;
    }
  }, []);
  usePolling(load, 8000);

  const p = data?.participants;
  return (
    <div>
      <PageHeader title="Event overview" description="Live numbers from the database. Refreshes every few seconds." />
      {error && <Alert tone="error" className="mb-5" title="Overview unavailable">{error}</Alert>}

      {data && data.setup.length > 0 && (
        <Panel className="mb-6" title="Before the event" description="Things that will block or weaken the competition.">
          <ul className="divide-y divide-line/60">
            {data.setup.map((s) => (
              <li key={s.message} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                {s.level === 'error' ? <CircleAlert className="h-4 w-4 shrink-0 text-rose-300" aria-label="Blocking" /> : <TriangleAlert className="h-4 w-4 shrink-0 text-amber-300" aria-label="Warning" />}
                <span className="flex-1 text-sm text-slate-200">{s.message}</span>
                <Link href={s.href} className="text-sm font-medium text-cyan-300 hover:text-cyan-200">Fix</Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Registered teams" value={p?.entries} hint={p ? `${p.members} participants` : undefined} />
        <Stat label="Checked in" value={p?.present} hint={p ? `${p.entries - p.present} not yet` : undefined} />
        <Stat label="Disqualified" value={p?.disqualified} />
        <Stat label="Online now" value={data?.logins.online} tone="good" hint={data ? `${data.logins.idle} idle` : undefined} />
        <Stat label="Answers submitted" value={data?.round1.submitted} hint={data ? `of ${data.round1.answers} assigned` : undefined} />
        <Stat label="Evaluations pending" value={data ? data.round1.evalPending : undefined} tone={data?.round1.evalFailed ? 'bad' : 'default'} hint={data?.round1.evalFailed ? `${data.round1.evalFailed} failed` : undefined} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <RoundCard title="Round 1" href="/admin/round1" round={data?.rounds.round1 ?? null} serverNow={data?.serverNow ?? null} ready={data?.round1.ready ?? false} readyText="Setup incomplete">
          {data ? <>
            <Progress label="Answers submitted" value={data.round1.submitted} max={data.round1.answers} />
            <Progress label="AI evaluations done" value={data.round1.evaluated} max={data.round1.answers} />
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone={data.round1.results ? 'violet' : 'neutral'}>{data.round1.results ? `Results computed (${data.round1.results})` : 'Results not computed'}</Badge>
              <Badge tone={data.results.round1Published ? 'green' : 'neutral'}>{data.results.round1Published ? 'Published to students' : 'Not published'}</Badge>
            </div>
          </> : <SkeletonRows rows={3} />}
        </RoundCard>
        <RoundCard title="Round 2" href="/admin/round2" round={data?.rounds.round2 ?? null} serverNow={data?.serverNow ?? null} ready={data?.round2.ready ?? false} readyText={data?.round2.configured ? 'Setup incomplete' : 'Not configured'}>
          {data ? <>
            <Progress label="Finalists submitted" value={data.round2.submitted} max={data.round2.finalists} />
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone={data.round2.finalists ? 'blue' : 'neutral'}>{data.round2.finalists} finalist{data.round2.finalists === 1 ? '' : 's'}</Badge>
              <Badge tone={data.results.finalComputed ? 'violet' : 'neutral'}>{data.results.finalComputed ? 'Final results computed' : 'Final results not computed'}</Badge>
              <Badge tone={data.results.finalPublished ? 'green' : 'neutral'}>{data.results.finalPublished ? 'Final published' : 'Final not published'}</Badge>
            </div>
          </> : <SkeletonRows rows={2} />}
        </RoundCard>
      </div>

      <Panel title="Recent activity" description="Every organizer action is recorded with who did it." actions={<Link href="/admin/settings#audit" className="text-sm text-cyan-300 hover:text-cyan-200">Export audit log</Link>}>
        {!data ? <SkeletonRows rows={5} /> : data.activity.length === 0 ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="No activity yet">Actions such as starting a round, importing participants or publishing results will appear here.</EmptyState>
        ) : (
          <ol className="divide-y divide-line/60">
            {data.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-sm first:pt-0 last:pb-0">
                <span className="font-medium text-slate-100">{activityLabel(a.action)}</span>
                {a.entry !== null && <span className="text-muted">entry {a.entry}</span>}
                <span className={cn('ml-auto text-xs text-faint')}>{a.by} · {timeAgo(a.at, new Date(data.serverNow).getTime())}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
