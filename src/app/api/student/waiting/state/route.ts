import { getSession } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession({ touch: true });
  if (!session) return jsonError('Sign in required.', 401);
  if (session.role !== 'student') return jsonError('Students only.', 403);
  try {
    const db = supabaseAdmin();
    await db.rpc('round1_tick');
    const { data, error } = await db.from('rounds').select('status, round_start_at, round_end_at').eq('round_number', 1).maybeSingle();
    if (error) throw error;
    return jsonOk({
      status: data?.status ?? 'not_started',
      roundStartAt: data?.round_start_at ?? null,
      roundEndAt: data?.round_end_at ?? null,
      entryNumber: session.entryNumber,
      serverNow: new Date().toISOString(),
    });
  } catch (err) {
    return serverError('waiting state', err, 'Could not refresh round status.');
  }
}
