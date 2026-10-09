import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Destructive reset for Round 1 only. Keeps registrations and attendance. */
export async function POST() {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const { data: round, error: roundError } = await db
    .from('rounds').select('id, status').eq('round_number', 1).single();
  if (roundError || !round) return NextResponse.json({ error: 'Round 1 not found.' }, { status: 404 });
  if (round.status === 'running' || round.status === 'paused') {
    return NextResponse.json({ error: 'Pause or stop Round 1 before resetting it.' }, { status: 409 });
  }

  const { data: assignments, error: assignmentError } = await db
    .from('challenge_assignments').select('id')
    .eq('round_id', round.id);
  if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 500 });

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  if (assignmentIds.length) {
    const { data: submissions, error: submissionFetchError } = await db
      .from('submissions').select('id').in('assignment_id', assignmentIds);
    if (submissionFetchError) return NextResponse.json({ error: submissionFetchError.message }, { status: 500 });
    const submissionIds = (submissions ?? []).map((s) => s.id);

    if (submissionIds.length) {
      for (const table of ['human_reviews', 'ai_evaluations']) {
        const { error } = await db.from(table).delete().in('submission_id', submissionIds);
        if (error) return NextResponse.json({ error: 'Could not reset Round 1 evaluation data: ' + error.message }, { status: 500 });
      }
      const { error } = await db.from('submissions').delete().in('id', submissionIds);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { error } = await db.from('challenge_assignments').delete().in('id', assignmentIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: resultsError } = await db.from('round_results').delete().eq('round_id', round.id);
  if (resultsError && !/column .*round_id.* does not exist/i.test(resultsError.message)) {
    return NextResponse.json({ error: resultsError.message }, { status: 500 });
  }

  const { error: updateError } = await db.from('rounds').update({
    status: 'not_started',
    round_start_at: null,
    round_end_at: null,
  }).eq('id', round.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: 'reset_round1',
    old_value: { status: round.status, assignments_deleted: assignmentIds.length },
    new_value: { status: 'not_started' },
  });

  await db.from('announcements').insert({
    message: 'Round 1 has been reset by the organizer. Please wait for the next start.',
    active: true,
    created_by: session.userId,
  });

  return NextResponse.json({ ok: true, status: 'not_started', assignmentsDeleted: assignmentIds.length });
}
