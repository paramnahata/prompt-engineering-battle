import { supabaseAdmin } from '@/lib/supabase/server';
import { rpcFailure, studentClaims } from '@/lib/auth/student';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Everything the student home screen needs, in one session-checked SQL call. */
export async function GET() {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('student_dashboard', { p_sid: auth.claims.sid, p_entry: auth.claims.sub });
    if (error) throw error;
    if (!data?.ok) return rpcFailure(data ?? {});
    return jsonOk(data);
  } catch (err) {
    return serverError('student dashboard', err, 'Could not load your dashboard. Retrying…');
  }
}
