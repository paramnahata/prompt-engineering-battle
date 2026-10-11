import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (!['pause', 'resume'].includes(action)) {
    return NextResponse.json({ error: 'Choose pause or resume.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: round, error } = await db.from('rounds')
    .select('id, status, round_end_at')
    .eq('round_number', 1)
    .single();

  if (error || !round) return NextResponse.json({ error: 'Round 1 not found.' }, { status: 404 });

  const expected = action === 'pause' ? 'running' : 'paused';
  const nextStatus = action === 'pause' ? 'paused' : 'running';
  if (round.status !== expected) {
    return NextResponse.json({ error: `Round 1 is currently ${round.status}; cannot ${action} it.`, status: round.status }, { status: 409 });
  }

  const { error: updateError } = await db.from('rounds')
    .update({ status: nextStatus })
    .eq('id', round.id)
    .eq('status', expected);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: `${action}_round1`,
    old_value: { status: expected },
    new_value: { status: nextStatus },
  });

  await db.from('announcements').insert({
    message: action === 'pause' ? 'Round 1 has been paused by the organizer.' : 'Round 1 has resumed.',
    active: true,
    created_by: session.userId,
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
