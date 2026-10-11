import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { enqueueEvaluation } from '@/lib/evaluation/queue';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ submissionId: z.string().uuid() });

/**
 * Called both when the student clicks "Next"/"Final Submit" and when a
 * per-challenge timer expires client-side. Idempotent: calling it twice
 * on an already-locked/submitted submission is a no-op, so a slow network
 * retry or a timer firing twice can't double-submit.
 *
 * PS 1-3: locks that one submission only, leaves the others untouched.
 * PS 4 (the last): locks AND submits all four at once — this is the real
 * "final submission" moment (spec section 14): generates one submission_ref,
 * stamps submitted_at, and enqueues all four for AI evaluation.
 */
export async function POST(req: NextRequest) {
  const session = requireRole('student');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { submissionId } = parsed.data;

  const db = supabaseAdmin();

  const { data: submission, error } = await db
    .from('submissions')
    .select('id, entry_id, assignment_id, status, question_end_at')
    .eq('id', submissionId)
    .single();
  if (error || !submission) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (submission.entry_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (submission.status !== 'draft') {
    // Already locked/submitted — treat as success so a retry/double-fire is harmless.
    return NextResponse.json({ ok: true, alreadyDone: true });
  }

  const { data: assignment } = await db
    .from('challenge_assignments')
    .select('position, round_id')
    .eq('id', submission.assignment_id)
    .single();
  if (!assignment) return NextResponse.json({ error: 'assignment not found' }, { status: 500 });
  const { data: round } = await db.from('rounds').select('status').eq('id', assignment.round_id).single();
  if (!round || round.status !== 'running') {
    return NextResponse.json({ error: 'Round 1 has ended. This submission is closed.', roundEnded: true }, { status: 409 });
  }

  if (submission.question_end_at && Date.now() < new Date(submission.question_end_at).getTime()) {
    return NextResponse.json({ error: 'This challenge timer has not finished yet.', timerNotExpired: true, secondsLeft: Math.ceil((new Date(submission.question_end_at).getTime() - Date.now()) / 1000) }, { status: 409 });
  }

  if (assignment.position < 4) {
    await db.from('submissions').update({ status: 'locked' }).eq('id', submissionId);
    await db.from('challenge_assignments').update({ locked_at: new Date().toISOString() }).eq('id', submission.assignment_id);
    return NextResponse.json({ ok: true, finalSubmit: false });
  }

  // Final challenge — lock + submit everything for this entry/round together.
  const { data: allSubmissions } = await db
    .from('submissions')
    .select('id, assignment_id')
    .eq('entry_id', session.userId);

  const { data: allAssignments } = await db
    .from('challenge_assignments')
    .select('id')
    .eq('entry_id', session.userId)
    .eq('round_id', assignment.round_id);

  const relevantIds = new Set((allAssignments ?? []).map((a) => a.id));
  const toSubmit = (allSubmissions ?? []).filter((s) => relevantIds.has(s.assignment_id));

  const now = new Date().toISOString();
  const submissionRef = `R1-${session.entryCode ?? session.userId.slice(0, 8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  for (const s of toSubmit) {
    await db
      .from('submissions')
      .update({ status: 'submitted', submitted_at: now, submission_ref: submissionRef })
      .eq('id', s.id);
    await enqueueEvaluation(s.id);
  }
  await db
    .from('challenge_assignments')
    .update({ locked_at: now })
    .in('id', Array.from(relevantIds));

  await db.from('activity_logs').insert({
    entry_id: session.userId,
    event_type: 'submission',
    metadata: { submission_ref: submissionRef },
  });

  return NextResponse.json({ ok: true, finalSubmit: true, submissionRef });
}
