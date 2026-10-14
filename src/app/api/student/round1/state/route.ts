import { supabaseAdmin } from '@/lib/supabase/server';
import { rpcFailure, studentClaims } from '@/lib/auth/student';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('student_round1_state', { p_sid: auth.claims.sid, p_entry: auth.claims.sub });
    if (error) throw error;
    if (!data?.ok) return rpcFailure(data ?? {});
    return jsonOk(data);
  } catch (err) {
    return serverError('round1 state', err, 'Could not load your challenge. Retrying…');
  }
}
