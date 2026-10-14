import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, readJson, rpcResponse, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Finalists + the Round 1 ranking to pick them from. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const { data: r1 } = await db.from('rounds').select('id').eq('round_number', 1).maybeSingle();
    const [quals, ranking] = await Promise.all([
      db.from('round2_qualifiers').select('entry_id, source, round1_rank, round1_score, added_at'),
      r1 ? db.from('round_results').select('entry_id, score, rank, qualified, entry:entries(entry_number, team_name, present, disqualified)').eq('round_id', r1.id).order('rank').limit(1000)
         : Promise.resolve({ data: [], error: null }),
    ]);
    if (quals.error) throw quals.error;
    return jsonOk({ finalists: quals.data ?? [], ranking: ranking.data ?? [] });
  } catch (err) {
    return serverError('round2 finalists', err, 'Could not load finalists.');
  }
}

const bodySchema = z.object({
  action: z.enum(['from_round1', 'add', 'remove', 'clear']),
  entryIds: z.array(z.string().uuid()).max(500).optional(),
  entryNumbers: z.array(z.number().int().positive()).max(500).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 32 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    let ids = body.data.entryIds ?? [];
    if (body.data.entryNumbers?.length) {
      const { data, error } = await db.from('entries').select('id').in('entry_number', body.data.entryNumbers);
      if (error) throw error;
      ids = [...ids, ...(data ?? []).map((e) => e.id)];
    }
    const { data, error } = await db.rpc('round2_set_qualifiers', { p_admin: auth.session.userId, p_action: body.data.action, p_entries: ids });
    if (error) throw error;
    return rpcResponse(data, 'Could not update finalists.');
  } catch (err) {
    return serverError('round2 finalists update', err, 'Could not update finalists.');
  }
}
