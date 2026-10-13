import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ confirm: z.string().max(40) });

/**
 * Reset Competition Data (Round 1 + Round 2). Admin only. One transaction:
 * refuses while a round is running/paused, holds locks so starts,
 * submissions and evaluations can't interleave, and writes an audit record.
 * Preserves registrations, members, entry numbers, PINs, attendance, the
 * challenge pool, accounts and settings.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('competition_reset', { p_admin: auth.session.userId, p_confirm: body.data.confirm });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Reset refused.', data?.status ?? 409, { code: data?.code });
    return jsonOk(data);
  } catch (err) {
    return serverError('competition reset', err, 'Reset failed and nothing was changed. Please retry.');
  }
}
