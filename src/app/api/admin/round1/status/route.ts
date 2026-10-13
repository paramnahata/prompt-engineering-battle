import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Dashboard snapshot: round state + counts. Head-only count queries, no row data. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    await db.rpc('round1_tick');
    const count = (q: PromiseLike<{ count: number | null; error: unknown }>) => q;
    const [round, registered, present, submitted, queued, processing, failed, evaluated, qualified, common] = await Promise.all([
      db.from('rounds').select('status, round_start_at, round_end_at, paused_at, total_paused_seconds, config').eq('round_number', 1).maybeSingle(),
      count(db.from('entries').select('id', { count: 'exact', head: true })),
      count(db.from('entries').select('id', { count: 'exact', head: true }).eq('present', true)),
      count(db.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'submitted')),
      count(db.from('evaluation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued')),
      count(db.from('evaluation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'processing')),
      count(db.from('evaluation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed')),
      count(db.from('ai_evaluations').select('id', { count: 'exact', head: true })),
      count(db.from('round_results').select('id', { count: 'exact', head: true }).eq('qualified', true)),
      db.from('challenges').select('common_slot, challenge_code, title').not('common_slot', 'is', null).eq('active', true),
    ]);
    if (round.error) throw round.error;
    return jsonOk({
      serverNow: new Date().toISOString(),
      round: round.data,
      counts: {
        registered: registered.count ?? 0,
        present: present.count ?? 0,
        submitted: submitted.count ?? 0,
        evalQueued: queued.count ?? 0,
        evalProcessing: processing.count ?? 0,
        evalFailed: failed.count ?? 0,
        evaluated: evaluated.count ?? 0,
        qualified: qualified.count ?? 0,
      },
      commonChallenges: common.data ?? [],
    });
  } catch (err) {
    return serverError('round1 status', err, 'Could not load the round status.');
  }
}
