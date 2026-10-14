import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hasStoredGeminiApiKey } from '@/lib/gemini/key-store';
import { getHealth } from '@/lib/ops/health';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Count = { count: number | null };
const n = (r: Count) => r.count ?? 0;

/**
 * Organizer overview: real counts from the database (head-only count
 * queries), both rounds, results status, setup warnings and recent activity.
 */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    await Promise.all([db.rpc('round1_tick'), db.rpc('round2_tick')]);
    const c = (table: string) => db.from(table).select('id', { count: 'exact', head: true });
    const [rounds, entries, present, withPin, presentNoPin, dq, members, live, subs, subsDone, jobsQ, jobsF, jobsDone,
      r1Results, finalists, r2Done, finalRes, pub, pre1, pre2, activity, health, geminiStored] = await Promise.all([
      db.from('rounds').select('round_number, status, round_start_at, round_end_at, paused_at').order('round_number'),
      c('entries'), c('entries').eq('present', true), c('entries').not('pin_hash', 'is', null),
      c('entries').eq('present', true).is('pin_hash', null), c('entries').eq('disqualified', true), c('team_members'),
      db.rpc('admin_live_participants'),
      c('submissions'), c('submissions').eq('status', 'submitted'),
      db.from('evaluation_jobs').select('id', { count: 'exact', head: true }).in('status', ['queued', 'processing']),
      c('evaluation_jobs').eq('status', 'failed'), c('evaluation_jobs').eq('status', 'completed'),
      c('round_results'), c('round2_qualifiers'), c('round2_states').in('state', ['FINAL_SUBMISSION', 'EVALUATION', 'RESULT']), c('final_results'),
      db.from('event_settings').select('value').eq('key', 'results_publication').maybeSingle(),
      db.rpc('round1_preflight'), db.rpc('round2_preflight'),
      db.from('admin_actions').select('id, action, created_at, admin:admins(full_name), entry:entries(entry_number)').order('created_at', { ascending: false }).limit(15),
      getHealth(), process.env.GEMINI_API_KEY?.trim() ? Promise.resolve(true) : hasStoredGeminiApiKey(),
    ]);
    if (rounds.error) throw rounds.error;
    const liveRows = (live.data ?? []) as { status: string }[];
    const r1 = (rounds.data ?? []).find((r) => r.round_number === 1) ?? null;
    const r2 = (rounds.data ?? []).find((r) => r.round_number === 2) ?? null;
    const p1 = (pre1.data ?? {}) as { ok?: boolean; errors?: string[]; warnings?: string[] };
    const p2 = (pre2.data ?? {}) as { ok?: boolean; errors?: string[]; config?: { confirmed?: boolean } };
    const publication = (pub.data?.value ?? {}) as Record<string, { published?: boolean }>;

    const setup: { level: 'error' | 'warning'; message: string; href: string }[] = [];
    if (!health.ok && health.database !== 'ok') setup.push({ level: 'error', message: 'Database migrations are missing for this deployment.', href: '/admin/settings' });
    if (health.missingRecommendedEnv.includes('PIN_PEPPER')) setup.push({ level: 'warning', message: 'PIN_PEPPER is not set; PINs depend on SESSION_SECRET.', href: '/admin/settings' });
    if (!geminiStored) setup.push({ level: 'warning', message: 'No Gemini API key is configured — AI evaluation cannot run.', href: '/admin/ai-settings' });
    if (r1?.status === 'not_started') for (const e of p1.errors ?? []) setup.push({ level: 'error', message: `Round 1: ${e}`, href: '/admin/challenges' });
    if (n(presentNoPin) > 0) setup.push({ level: 'warning', message: `${n(presentNoPin)} checked-in team(s) have no PIN yet.`, href: '/admin/attendance' });
    if (r2?.status === 'not_started' && !p2.config?.confirmed) setup.push({ level: 'warning', message: 'Round 2 settings have not been reviewed and saved.', href: '/admin/round2' });

    return jsonOk({
      serverNow: new Date().toISOString(),
      rounds: { round1: r1, round2: r2 },
      participants: { entries: n(entries), members: n(members), present: n(present), withPin: n(withPin), disqualified: n(dq) },
      logins: { online: liveRows.filter((r) => r.status === 'online').length, idle: liveRows.filter((r) => r.status === 'idle').length, offline: liveRows.filter((r) => r.status === 'offline').length },
      round1: { answers: n(subs), submitted: n(subsDone), evalPending: n(jobsQ), evalFailed: n(jobsF), evaluated: n(jobsDone), results: n(r1Results), ready: p1.ok ?? false },
      round2: { finalists: n(finalists), submitted: n(r2Done), configured: Boolean(p2.config?.confirmed), ready: p2.ok ?? false },
      results: { round1Published: Boolean(publication.round1?.published), finalComputed: n(finalRes), finalPublished: Boolean(publication.final?.published) },
      setup,
      activity: (activity.data ?? []).map((a) => ({
        id: a.id, action: a.action, at: a.created_at,
        by: (Array.isArray(a.admin) ? a.admin[0] : a.admin)?.full_name ?? 'System',
        entry: (Array.isArray(a.entry) ? a.entry[0] : a.entry)?.entry_number ?? null,
      })),
    });
  } catch (err) {
    return serverError('overview', err, 'Could not load the overview.');
  }
}
