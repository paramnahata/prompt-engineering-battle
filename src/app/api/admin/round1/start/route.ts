import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { generateRound1Assignments } from '@/lib/evaluation/assignment-engine';

export const dynamic = 'force-dynamic';

/**
 * The one button that actually starts the event for students: generates
 * any missing Round 1 assignments (idempotent — already-assigned entries
 * are skipped), then flips the round to "running" with a server-authoritative
 * end time. Per-challenge sub-timers are started lazily per student by
 * /api/student/round1/state the first time each challenge becomes current.
 */
export async function POST() {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const { data: round, error: roundErr } = await db.from('rounds').select('*').eq('round_number', 1).single();
  if (roundErr || !round) return NextResponse.json({ error: 'Round 1 not found' }, { status: 500 });

  if (round.status === 'running') {
    return NextResponse.json({ error: 'Round 1 is already running' }, { status: 409 });
  }

  let assignmentResult;
  try {
    assignmentResult = await generateRound1Assignments(round.id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Assignment generation failed' }, { status: 500 });
  }

  const durationSeconds = round.config?.round_duration_seconds ?? 1800;
  const now = new Date();
  const roundEndAt = new Date(now.getTime() + durationSeconds * 1000);

  const { error: updateErr } = await db
    .from('rounds')
    .update({ status: 'running', round_start_at: now.toISOString(), round_end_at: roundEndAt.toISOString() })
    .eq('id', round.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: 'start_round1',
    new_value: { assigned: assignmentResult.assigned, skipped: assignmentResult.skipped },
  });

  await db.from('announcements').insert({ message: 'Round 1 has started!', active: true, created_by: session.userId });

  return NextResponse.json({ ok: true, ...assignmentResult, roundEndAt: roundEndAt.toISOString() });
}
