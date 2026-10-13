import { NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError, uuidSchema } from '@/lib/http';
import { challengeFieldsSchema, poolLockedResponse, toRow } from '@/lib/challenges/server';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { challengeId: string } }) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const id = uuidSchema.safeParse(params.challengeId);
  if (!id.success) return jsonError('Challenge not found.', 404);
  try {
    const { data, error } = await supabaseAdmin().from('challenges').select('*').eq('id', id.data).maybeSingle();
    if (error) throw error;
    if (!data) return jsonError('Challenge not found.', 404);
    return jsonOk({ challenge: data });
  } catch (err) {
    return serverError('challenge get', err, 'Could not load the challenge.');
  }
}

/** Edit one challenge (all fields). Past assignments keep their snapshot. */
export async function PATCH(req: NextRequest, { params }: { params: { challengeId: string } }) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const id = uuidSchema.safeParse(params.challengeId);
  if (!id.success) return jsonError('Challenge not found.', 404);
  const body = await readJson(req, challengeFieldsSchema, 64 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const locked = await poolLockedResponse(db);
    if (locked) return locked;
    const row: Record<string, unknown> = { ...toRow(body.data), updated_at: new Date().toISOString(), updated_by: auth.session.userId };
    if (body.data.pool_status !== 'approved' || body.data.active === false) row.common_slot = null;
    const { data, error } = await db.from('challenges').update(row).eq('id', id.data).neq('pool_status', 'archived').select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return jsonError(`PS ID ${body.data.challenge_code} already exists.`, 409);
      throw error;
    }
    if (!data) return jsonError('Challenge not found (archived challenges are read-only).', 404);
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'challenge_edit', new_value: { id: id.data, code: body.data.challenge_code } });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('challenge edit', err, 'Could not save the challenge.');
  }
}
