import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Readiness check shown before starting: commons, eligible counts, team sizes, PINs. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('round1_preflight');
    if (error) throw error;
    return jsonOk(data);
  } catch (err) {
    return serverError('preflight', err, 'Could not run the readiness check.');
  }
}
