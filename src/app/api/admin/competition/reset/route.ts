import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';
import { limitAction } from '@/lib/ops/rate-limit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ confirm: z.string().max(40) });

/** Preview of exactly what a reset would clear and keep (counts), and whether it is currently blocked. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('competition_reset_preview');
    if (error) throw error;
    return jsonOk(data ?? {});
  } catch (err) {
    return serverError('reset preview', err, 'Could not load the reset preview.');
  }
}

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
    const limited = await limitAction(`reset:${auth.session.userId}`, 5, 300);
    if (limited) return limited;
    const { data, error } = await supabaseAdmin().rpc('competition_reset', { p_admin: auth.session.userId, p_confirm: body.data.confirm });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Reset refused.', data?.status ?? 409, { code: data?.code });
    return jsonOk(data);
  } catch (err) {
    return serverError('competition reset', err, 'Reset failed and nothing was changed. Please retry.');
  }
}
