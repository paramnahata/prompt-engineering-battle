import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, serverError } from '@/lib/http';
import { currentTeamCodes } from '@/lib/auth/team-code';

export const dynamic = 'force-dynamic';

/**
 * Current rotating PIN of every entry, for the registration desk (volunteers
 * and admins only). PINs change every 60 seconds; the response says when.
 */
export async function GET() {
  const auth = await requireApiRole(['volunteer', 'admin']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().from('entries').select('entry_number').not('entry_number', 'is', null).limit(5000);
    if (error) throw error;
    const numbers = (data ?? []).map((e) => e.entry_number as number);
    return new Response(JSON.stringify(currentTeamCodes(numbers)), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err) {
    return serverError('team codes', err, 'Could not load team PINs.');
  }
}
