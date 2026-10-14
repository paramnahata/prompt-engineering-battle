import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { processRound2Queue } from '@/lib/evaluation/queue';
import { limitAction } from '@/lib/ops/rate-limit';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const statuses = ['queued', 'processing', 'completed', 'failed'] as const;
    const counts = await Promise.all(statuses.map((s) => db.from('round2_eval_jobs').select('id', { count: 'exact', head: true }).eq('status', s)));
    const { data: failed, error } = await db.from('round2_eval_jobs')
      .select('id, entry_id, retry_count, last_error, entry:entries(entry_number, team_name)').eq('status', 'failed').limit(100);
    if (error) throw error;
    return jsonOk({ counts: Object.fromEntries(statuses.map((s, i) => [s, counts[i]?.count ?? 0])), failed: failed ?? [] });
  } catch (err) {
    return serverError('round2 evaluations', err, 'Could not load Round 2 evaluation status.');
  }
}

const bodySchema = z.object({ action: z.enum(['run', 'retry_failed']) });

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 512);
  if (!body.ok) return body.response;
  try {
    const limited = await limitAction(`eval-run:${auth.session.userId}`, 60, 300);
    if (limited) return limited;
    const db = supabaseAdmin();
    if (body.data.action === 'retry_failed') {
      const { data, error } = await db.from('round2_eval_jobs').update({ status: 'queued', retry_count: 0, next_attempt_at: new Date().toISOString() }).eq('status', 'failed').select('id');
      if (error) throw error;
      await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'retry_failed_round2_evaluations', new_value: { requeued: data?.length ?? 0 } });
      return jsonOk({ ok: true, requeued: data?.length ?? 0 });
    }
    const result = await processRound2Queue({ timeBudgetMs: 45_000 });
    const { count } = await db.from('round2_eval_jobs').select('id', { count: 'exact', head: true }).in('status', ['queued', 'processing']);
    return jsonOk({ ok: true, ...result, remaining: count ?? 0 });
  } catch (err) {
    return serverError('round2 run evaluations', err, 'Evaluation run failed. Check AI Judging settings and retry.');
  }
}
