import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'stop', 'reset', 'assign_missing']),
  confirm: z.string().max(40).optional(),
});

/**
 * All Round 1 transitions go through one SQL function that locks the round
 * row, validates the current state and writes the audit trail in the same
 * transaction. Buttons in the UI are a convenience, not the enforcement.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 2048);
  if (!body.ok) return body.response;
  try {
    // Start over goes through round1_start_over, which refuses once Round 2 has begun.
    const { data, error } = body.data.action === 'reset'
      ? await supabaseAdmin().rpc('round1_start_over', { p_admin: auth.session.userId, p_confirm: body.data.confirm ?? null })
      : await supabaseAdmin().rpc('round1_control', {
          p_action: body.data.action,
          p_admin: auth.session.userId,
          p_confirm: body.data.confirm ?? null,
        });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Action not allowed right now.', data?.status ?? 409, { code: data?.code });
    return jsonOk(data);
  } catch (err) {
    return serverError('round1 control', err, 'The round action failed. Refresh and check the round status before retrying.');
  }
}
