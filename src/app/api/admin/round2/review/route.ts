import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, rpcResponse, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('override'), entryId: z.string().uuid(), newScore: z.number().finite().min(0).max(1000), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('unlock_jury'), entryId: z.string().uuid(), judgeId: z.string().uuid() }),
]);

/** Admin review of Round 2: score override (audited, never edits jury/AI rows) and unlocking a judge's score. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 4096);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    if (body.data.action === 'unlock_jury') {
      const { data, error } = await db.rpc('jury_unlock_score', { p_admin: auth.session.userId, p_entry: body.data.entryId, p_judge: body.data.judgeId });
      if (error) throw error;
      return rpcResponse(data);
    }
    const { entryId, newScore, reason } = body.data;
    const { data: fin } = await db.from('round2_states').select('entry_id').eq('entry_id', entryId).maybeSingle();
    if (!fin) return jsonError('That team has no Round 2 work.', 404);
    const [{ data: last }, { data: fr }] = await Promise.all([
      db.from('round2_reviews').select('new_score').eq('entry_id', entryId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('final_results').select('round2_score').eq('entry_id', entryId).maybeSingle(),
    ]);
    const old = last?.new_score ?? fr?.round2_score ?? null;
    const rounded = Math.round(newScore * 10) / 10;
    const { error } = await db.from('round2_reviews').insert({ entry_id: entryId, reviewer_id: auth.session.userId, old_score: old, new_score: rounded, reason });
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, entry_id: entryId, action: 'round2_score_override', reason, old_value: { score: old }, new_value: { score: rounded } });
    return jsonOk({ ok: true, note: 'Recompute final results to apply the override.' });
  } catch (err) {
    return serverError('round2 review', err, 'Could not save the review.');
  }
}
