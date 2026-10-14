import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Round 1 leaderboard (admin only — scores are never shown to students or the projector). */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const { data: round } = await db.from('rounds').select('id').eq('round_number', 1).maybeSingle();
    if (!round) return jsonOk({ results: [], qualificationPercent: 15 });
    const [{ data, error }, { data: setting }] = await Promise.all([
      db.from('round_results')
        .select('score, rank, qualified, computed_at, entry:entries(id, entry_number, team_name, team_members(member_position, full_name))')
        .eq('round_id', round.id)
        .order('rank', { ascending: true })
        .limit(1000),
      db.from('event_settings').select('value').eq('key', 'qualification_percent').maybeSingle(),
    ]);
    if (error) throw error;
    return jsonOk({ results: data ?? [], qualificationPercent: Number(setting?.value ?? 15) || 15 });
  } catch (err) {
    return serverError('results', err, 'Could not load results.');
  }
}

const postSchema = z.object({
  qualificationPercent: z.number().min(1).max(100).optional(),
  force: z.boolean().optional(),
});

/** Computes ranks from AI scores, with the latest human override winning. Ties at the cutoff all qualify. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, postSchema, 512);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    let percent = body.data.qualificationPercent;
    if (percent === undefined) {
      const { data: setting } = await db.from('event_settings').select('value').eq('key', 'qualification_percent').maybeSingle();
      percent = Number(setting?.value ?? 15) || 15;
    }
    const { data, error } = await db.rpc('compute_round1_results', { p_admin: auth.session.userId, p_percent: percent, p_force: body.data.force ?? false });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Could not compute results.', data?.status ?? 409, { code: data?.code, pending: data?.pending });
    return jsonOk({ ...data, qualificationPercent: percent });
  } catch (err) {
    return serverError('compute results', err, 'Could not compute results.');
  }
}
