import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin()
      .from('challenges')
      .select('id, challenge_code, title, category, difficulty, active, common_slot, prompt_word_limit, output_char_limit, created_at')
      .order('challenge_code', { ascending: true })
      .limit(1000);
    if (error) throw error;
    return jsonOk({ challenges: data ?? [] });
  } catch (err) {
    return serverError('challenges list', err, 'Could not load challenges.');
  }
}

const patchSchema = z.union([
  z.object({ action: z.literal('set_active'), ids: z.array(z.string().uuid()).min(1).max(500), active: z.boolean() }),
  z.object({ action: z.literal('set_common'), slot: z.union([z.literal(1), z.literal(2)]), id: z.string().uuid().nullable() }),
]);

/**
 * Pool changes are locked once Round 1 has assignments, so the challenges
 * students were given can't change underneath them.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, patchSchema, 32 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { count } = await db.from('challenge_assignments').select('id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) return jsonError('Round 1 already has assignments. Use Start Over before changing the challenge pool.', 409);

    if (body.data.action === 'set_active') {
      const { error } = await db.from('challenges').update({ active: body.data.active }).in('id', body.data.ids);
      if (error) throw error;
      if (!body.data.active) await db.from('challenges').update({ common_slot: null }).in('id', body.data.ids);
    } else {
      const { slot, id } = body.data;
      const { error: clearErr } = await db.from('challenges').update({ common_slot: null }).eq('common_slot', slot);
      if (clearErr) throw clearErr;
      if (id) {
        const { data, error } = await db.from('challenges').update({ common_slot: slot, active: true }).eq('id', id).select('id').maybeSingle();
        if (error) {
          if (error.code === '23505') return jsonError('That challenge is already the other common challenge.', 409);
          throw error;
        }
        if (!data) return jsonError('Challenge not found.', 404);
      }
    }
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'challenge_pool_update', new_value: body.data });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('challenges update', err, 'Could not update challenges.');
  }
}
