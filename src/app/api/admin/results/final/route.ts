import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, readJson, rpcResponse, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Final standings (Round 1 + Round 2, weights from the Round 2 settings). */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().from('final_results')
      .select('entry_id, round1_score, round2_score, round2_jury, round2_ai, final_score, rank, released, computed_at, entry:entries(entry_number, team_name, team_members(member_position, full_name))')
      .order('rank').limit(500);
    if (error) throw error;
    return jsonOk({ results: data ?? [] });
  } catch (err) {
    return serverError('final results', err, 'Could not load final results.');
  }
}

const bodySchema = z.object({ force: z.boolean().default(false) });

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 256);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('compute_final_results', { p_admin: auth.session.userId, p_force: body.data.force });
    if (error) throw error;
    return rpcResponse(data, 'Could not compute final results.');
  } catch (err) {
    return serverError('compute final results', err, 'Could not compute final results.');
  }
}
