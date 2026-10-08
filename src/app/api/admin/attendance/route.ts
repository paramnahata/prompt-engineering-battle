import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

/** GET /api/admin/attendance?entryCode=ENTRY-001 — look up an entry for check-in. */
export async function GET(req: NextRequest) {
  const session = requireAnyRole(['admin', 'volunteer']);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const entryCode = req.nextUrl.searchParams.get('entryCode')?.trim().toUpperCase();
  if (!entryCode) return NextResponse.json({ error: 'entryCode required' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: entry, error } = await db
    .from('entries')
    .select('id, entry_code, team_name, is_team, payment_status, present, disqualified, team_members(member_position, full_name)')
    .eq('entry_code', entryCode)
    .single();

  if (error || !entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  return NextResponse.json({ entry });
}

const postSchema = z.object({ entryId: z.string().uuid(), present: z.boolean() });

/** POST { entryId, present } — mark an entry present/absent. */
export async function POST(req: NextRequest) {
  const session = requireAnyRole(['admin', 'volunteer']);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { entryId, present } = parsed.data;

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  // Only write entries.present — the DB trigger (see migration
  // attendance_consistency_trigger) automatically keeps the attendance
  // log table in sync. Writing to both here was the source of the
  // inconsistency: this route could get out of sync with any other path
  // that touches entries.present (manual SQL, future bulk actions, etc).
  const { error: updateErr } = await db
    .from('entries')
    .update({ present, present_at: present ? now : null })
    .eq('id', entryId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

  await db.from('activity_logs').insert({
    entry_id: entryId,
    user_id: session.role === 'admin' ? session.userId : null,
    event_type: 'attendance',
    metadata: { present, marked_by_role: session.role },
  });

  return NextResponse.json({ ok: true });
}
