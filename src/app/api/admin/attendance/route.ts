import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const postSchema = z.object({ entryId: z.string().uuid(), present: z.boolean() });

/** Mark an entry present/absent. The DB trigger keeps the attendance log in sync. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'volunteer']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, postSchema, 1024);
  if (!body.ok) return body.response;
  const { entryId, present } = body.data;
  try {
    const db = supabaseAdmin();
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('entries')
      .update({ present, present_at: present ? now : null })
      .eq('id', entryId)
      .select('id, entry_number, present, present_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonError('Entry not found.', 404);
    await db.from('activity_logs').insert({
      entry_id: entryId,
      user_id: auth.session.userId,
      event_type: 'attendance',
      metadata: { present, marked_by_role: auth.session.role },
    });
    return jsonOk({ ok: true, entry: data });
  } catch (err) {
    return serverError('attendance', err, 'Could not update attendance. Please retry.');
  }
}
