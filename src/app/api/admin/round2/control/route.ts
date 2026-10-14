import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { readJson, rpcResponse, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'stop', 'reveal_twist', 'reset']),
  confirm: z.string().max(40).optional(),
});

/** Round 2 transitions: one locked SQL function validates state and writes the audit trail. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('round2_control', {
      p_action: body.data.action, p_admin: auth.session.userId, p_confirm: body.data.confirm ?? null,
    });
    if (error) throw error;
    return rpcResponse(data);
  } catch (err) {
    return serverError('round2 control', err, 'The round action failed. Refresh and check the status before retrying.');
  }
}
