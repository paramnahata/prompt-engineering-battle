import { NextResponse } from 'next/server';
import { requireAnyRole, requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Full participant list for the Registration Desk table. */
export async function GET() {
  const session = requireAnyRole(['admin', 'volunteer']);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const { data: entries, error } = await db
    .from('entries')
    .select('id, entry_code, team_name, payment_status, present, disqualified, created_at, team_members(member_position, full_name)')
    .order('entry_code', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: entries ?? [] });
}

/**
 * Wipes every entry (and, via ON DELETE CASCADE, their team_members,
 * attendance history, submissions, results, etc.) so the desk can start a
 * clean CSV import. Admin-only — this is destructive and not something a
 * volunteer should be able to trigger by mis-click.
 */
export async function DELETE() {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const { error, count } = await db.from('entries').delete({ count: 'exact' }).not('id', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: 'reset_participants',
    old_value: { deleted_count: count },
  });

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
