import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { studentClaims } from '@/lib/auth/student';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  event_type: z.enum(['tab_hidden', 'tab_visible', 'window_blur', 'paste_blocked']),
});

/** Integrity telemetry from the challenge page. Fixed event names only, no free-form payload. */
export async function POST(req: NextRequest) {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { data: alive } = await db.rpc('auth_session_validate', { p_sid: auth.claims.sid, p_touch: false });
    if (!alive?.valid) return jsonOk({ ok: false });
    await db.from('activity_logs').insert({ entry_id: auth.claims.sub, event_type: body.data.event_type, metadata: {} });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('student log', err);
  }
}
