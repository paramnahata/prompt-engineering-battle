import { NextRequest } from 'next/server';
import { z } from 'zod';
import { endSessionsForSubject, requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ entryId: z.string().uuid() });

/** Signs an entry out everywhere so the team can sign in on a new device. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'volunteer']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  try {
    await endSessionsForSubject(body.data.entryId, 'released_by_organizer');
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
