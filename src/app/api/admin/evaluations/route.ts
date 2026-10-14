import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { processEvaluationQueue } from '@/lib/evaluation/queue';
import { jsonOk, readJson, serverError } from '@/lib/http';
import { limitAction } from '@/lib/ops/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Queue health + the failures an admin needs to act on. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const statuses = ['queued', 'processing', 'completed', 'failed'] as const;
    const counts = await Promise.all(statuses.map((s) => db.from('evaluation_jobs').select('id', { count: 'exact', head: true }).eq('status', s)));
    const { data: failed, error } = await db
      .from('evaluation_jobs')
      .select('id, status, retry_count, last_error, queued_at, submission:submissions(id, entry:entries(id, entry_number, team_name), assignment:challenge_assignments(position))')
      .eq('status', 'failed')
      .order('queued_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    return jsonOk({
      counts: Object.fromEntries(statuses.map((s, i) => [s, counts[i]?.count ?? 0])),
      failed: failed ?? [],
    });
  } catch (err) {
    return serverError('evaluations status', err, 'Could not load evaluation status.');
  }
}

const postSchema = z.object({ action: z.enum(['run', 'retry_failed']) });

/**
 * run: processes queued jobs for up to ~40s (the dashboard calls this
 * repeatedly while "Run evaluation" is on). retry_failed: re-queues every
 * failed job (e.g. after fixing the API key).
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, postSchema, 512);
  if (!body.ok) return body.response;
  try {
    const limited = await limitAction(`eval-run:${auth.session.userId}`, 60, 300);
    if (limited) return limited;
    const db = supabaseAdmin();
    if (body.data.action === 'retry_failed') {
      const { data, error } = await db.from('evaluation_jobs')
        .update({ status: 'queued', retry_count: 0, next_attempt_at: new Date().toISOString() })
        .eq('status', 'failed')
        .select('id');
      if (error) throw error;
      await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'retry_failed_evaluations', new_value: { requeued: data?.length ?? 0 } });
      return jsonOk({ ok: true, requeued: data?.length ?? 0 });
    }
    const result = await processEvaluationQueue({ timeBudgetMs: 45_000 });
    const { count: remaining } = await db.from('evaluation_jobs').select('id', { count: 'exact', head: true }).in('status', ['queued', 'processing']);
    return jsonOk({ ok: true, ...result, remaining: remaining ?? 0 });
  } catch (err) {
    return serverError('run evaluations', err, 'Evaluation run failed. Check AI Judging settings and retry.');
  }
}
