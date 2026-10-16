import { NextRequest } from 'next/server';
import { z } from 'zod';
import { endSessionsForSubject, requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ entryId: z.string().uuid() });

/** Signs an entry out everywhere and lifts any wrong-PIN lockout, so the team can sign in (again) on any device. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'volunteer']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  try {
    await endSessionsForSubject(body.data.entryId, 'released_by_organizer');
    // Also lift a wrong-PIN lockout, so a team someone else locked out (by typing
    // wrong PINs for their entry number) can sign in again straight away.
    const db = supabaseAdmin();
    const { data: entry } = await db.from('entries').select('entry_number').eq('id', body.data.entryId).maybeSingle();
    if (entry?.entry_number != null) {
      const { error: unlockError } = await db.from('rate_limits').delete().eq('key', `student-login-entry:${entry.entry_number}`);
      if (unlockError) console.error('Could not clear the login lockout.');
    }
    await supabaseAdmin().from('admin_actions').insert({
      admin_id: auth.session.role === 'admin' || auth.session.role === 'volunteer' ? auth.session.userId : null,
      entry_id: body.data.entryId,
      action: 'release_student_session',
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('release session', err, 'Could not release the session.');
  }
}
