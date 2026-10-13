import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { entryPayloadSchema } from '@/lib/participants';
import { jsonError, jsonOk, readJson, serverError, uuidSchema } from '@/lib/http';

export const dynamic = 'force-dynamic';

const patchSchema = entryPayloadSchema.extend({
  disqualified: z.boolean().optional(),
  disqualified_reason: z.string().trim().max(300).optional(),
});

/** Admin edit of one entry: team name, 1–2 members, disqualification. Atomic. */
export async function PATCH(req: NextRequest, { params }: { params: { entryId: string } }) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const entryId = uuidSchema.safeParse(params.entryId);
  if (!entryId.success) return jsonError('Entry not found.', 404);
  const body = await readJson(req, patchSchema, 8 * 1024);
  if (!body.ok) return body.response;
  try {
    const payload = {
      ...body.data,
      members: body.data.members.map((m) => ({ ...m, phone: (m.phone ?? '').replace(/[^\d+]/g, '') })),
    };
    const { data, error } = await supabaseAdmin().rpc('update_entry', { p_entry: entryId.data, p_admin: auth.session.userId, p_payload: payload });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Could not update the entry.', data?.status ?? 400, { code: data?.code });
    if (body.data.disqualified) {
      await supabaseAdmin().from('auth_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'account_changed' })
        .eq('entry_id', entryId.data).is('ended_at', null);
    }
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('edit entry', err, 'Could not update the entry.');
  }
}
