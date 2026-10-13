import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError, uuidSchema } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('publish'),
    mode: z.enum(['merge', 'replace']),
    poolStatus: z.enum(['approved', 'review']),
    defaults: z.object({ prompt_word_limit: z.number().int().min(10).max(2000), output_char_limit: z.number().int().min(100).max(50_000) }),
  }),
  z.object({ action: z.literal('discard') }),
]);

/** Publish a reviewed draft to the live pool (one transaction), or discard it. */
export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const id = uuidSchema.safeParse(params.batchId);
  if (!id.success) return jsonError('Import draft not found.', 404);
  const body = await readJson(req, bodySchema, 2048);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    if (body.data.action === 'discard') {
      const { data, error } = await db.from('challenge_import_batches').update({ status: 'discarded' }).eq('id', id.data).eq('status', 'draft').select('id').maybeSingle();
      if (error) throw error;
      if (!data) return jsonError('Only drafts can be discarded.', 409);
      return jsonOk({ ok: true });
    }
    const { data, error } = await db.rpc('publish_challenge_import', {
      p_batch: id.data, p_admin: auth.session.userId, p_mode: body.data.mode, p_pool_status: body.data.poolStatus, p_defaults: body.data.defaults,
    });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Publish refused.', data?.status ?? 409, { code: data?.code });
    return jsonOk(data);
  } catch (err) {
    return serverError('challenge publish', err, 'Publishing failed and the pool was not changed. Please retry.');
  }
}
