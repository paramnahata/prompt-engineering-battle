import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const fields = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  active: z.boolean().optional(),
});
const SELECT = 'id, title, description, active, created_at, updated_at';

/** Surprise twists for Round 2 (optional stage). Revealed teams keep a snapshot. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().from('surprise_twists').select(SELECT).order('created_at');
    if (error) throw error;
    return jsonOk({ twists: data ?? [] });
  } catch (err) {
    return serverError('round2 twists', err, 'Could not load twists.');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, fields, 16 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('surprise_twists').insert({ ...body.data, active: body.data.active ?? true }).select(SELECT).single();
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round2_twist_create', new_value: { id: data.id, title: data.title } });
    return jsonOk({ ok: true, twist: data });
  } catch (err) {
    return serverError('round2 twist create', err, 'Could not save the twist.');
  }
}

const patchSchema = fields.partial().extend({ id: z.string().uuid() });

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, patchSchema, 16 * 1024);
  if (!body.ok) return body.response;
  const { id, ...changes } = body.data;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('surprise_twists').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) return jsonError('Twist not found.', 404);
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round2_twist_update', new_value: data });
    return jsonOk({ ok: true, twist: data });
  } catch (err) {
    return serverError('round2 twist update', err, 'Could not update the twist.');
  }
}

const deleteSchema = z.object({ id: z.string().uuid(), confirm: z.literal('DELETE') });

export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, deleteSchema, 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { count } = await db.from('round2_states').select('id', { count: 'exact', head: true }).eq('twist_id', body.data.id);
    if ((count ?? 0) > 0) {
      await db.from('surprise_twists').update({ active: false }).eq('id', body.data.id);
      return jsonOk({ ok: true, disabled: true });
    }
    const { error } = await db.from('surprise_twists').delete().eq('id', body.data.id);
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round2_twist_delete', old_value: { id: body.data.id } });
    return jsonOk({ ok: true, deleted: true });
  } catch (err) {
    return serverError('round2 twist delete', err, 'Could not delete the twist.');
  }
}
