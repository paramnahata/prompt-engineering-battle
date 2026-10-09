import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const { data: round, error: roundError } = await db
    .from('rounds').select('id, status').eq('round_number', 1).single();

  if (roundError || !round) return NextResponse.json({ error: 'Round 1 not found' }, { status: 404 });
  if (round.status !== 'running') {
    return NextResponse.json({ error: 'Round 1 is not currently running.' }, { status: 409 });
  }

  const stoppedAt = new Date().toISOString();
  const { error: updateError } = await db.from('rounds')
    .update({ status: 'ended', round_end_at: stoppedAt })
    .eq('id', round.id)
    .eq('status', 'running');

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: 'stop_round1',
    old_value: { status: 'running' },
    new_value: { status: 'ended', stopped_at: stoppedAt },
  });
  await db.from('announcements').insert({
    message: 'Round 1 has been stopped by the organizer.',
    active: true,
    created_by: session.userId,
  });

  return NextResponse.json({ ok: true, status: 'ended', stoppedAt });
}
