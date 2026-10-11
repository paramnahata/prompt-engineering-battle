import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = requireRole('student');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const serverNow = new Date();
  const { data: round, error: roundError } = await db
    .from('rounds').select('id, status, round_end_at, config')
    .eq('round_number', 1).single();

  if (roundError || !round) {
    return NextResponse.json({ error: 'Round 1 is not configured yet.', roundStatus: 'not_started', serverNow: serverNow.toISOString() }, { status: 200 });
  }
  if (round.status !== 'running') {
    return NextResponse.json({ serverNow: serverNow.toISOString(), roundStatus: round.status, assignments: [], submissions: [], currentSubmissionId: null });
  }

  const { data: assignments, error: assignmentError } = await db
    .from('challenge_assignments')
    .select('id, position, challenge_id, locked_at, challenge:challenges(title, problem_statement, instructions, constraints, expected_output, prompt_word_limit, output_char_limit)')
    .eq('entry_id', session.userId)
    .eq('round_id', round.id)
    .order('position', { ascending: true });

  if (assignmentError) {
    return NextResponse.json({ error: 'Could not load your assigned challenges. Please retry.' }, { status: 500 });
  }
  if (!assignments?.length) {
    return NextResponse.json({ serverNow: serverNow.toISOString(), roundStatus: round.status, roundEndAt: round.round_end_at, assignments: [], submissions: [], currentSubmissionId: null });
  }

  const assignmentIds = assignments.map((a) => a.id);
  const { data: existingSubmissions, error: submissionError } = await db
    .from('submissions')
    .select('id, assignment_id, prompt_text, ai_output_text, status, question_start_at, question_end_at, submitted_at, submission_ref')
    .eq('entry_id', session.userId)
    .in('assignment_id', assignmentIds);

  if (submissionError) {
    return NextResponse.json({ error: 'Could not load your saved responses. Please refresh.' }, { status: 500 });
  }

  // Repair partial setup safely: every assigned challenge must have one draft submission row.
  const existingAssignmentIds = new Set((existingSubmissions ?? []).map((s) => s.assignment_id));
  const missing = assignments.filter((a) => !existingAssignmentIds.has(a.id));
  if (missing.length) {
    const { error: insertError } = await db.from('submissions').insert(
      missing.map((a) => ({ entry_id: session.userId, assignment_id: a.id }))
    );
    if (insertError) {
      return NextResponse.json({ error: 'Your challenges are assigned but response records could not be prepared. Ask the organizer to repair your entry.' }, { status: 500 });
    }
  }

  let submissions = existingSubmissions ?? [];
  if (missing.length) {
    const { data: refreshed, error: refreshError } = await db
      .from('submissions')
      .select('id, assignment_id, prompt_text, ai_output_text, status, question_start_at, question_end_at, submitted_at, submission_ref')
      .eq('entry_id', session.userId)
      .in('assignment_id', assignmentIds);
    if (refreshError) return NextResponse.json({ error: 'Could not refresh your response records. Please retry.' }, { status: 500 });
    submissions = refreshed ?? [];
  }

  const positionOf = (assignmentId: string) => assignments.find((a) => a.id === assignmentId)?.position ?? 999;
  submissions.sort((a, b) => positionOf(a.assignment_id) - positionOf(b.assignment_id));
  const currentSubmission = submissions.find((s) => s.status === 'draft');

  if (currentSubmission && !currentSubmission.question_start_at) {
    const challengeSeconds = round.config?.challenge_seconds ?? 450;
    const roundEnd = round.round_end_at ? new Date(round.round_end_at).getTime() : Infinity;
    const start = serverNow;
    const end = new Date(Math.min(start.getTime() + challengeSeconds * 1000, roundEnd));
    const { error: timerError } = await db.from('submissions')
      .update({ question_start_at: start.toISOString(), question_end_at: end.toISOString() })
      .eq('id', currentSubmission.id)
      .eq('status', 'draft');
    if (timerError) return NextResponse.json({ error: 'Could not start the challenge timer. Please retry.' }, { status: 500 });
    currentSubmission.question_start_at = start.toISOString();
    currentSubmission.question_end_at = end.toISOString();
  }

  return NextResponse.json({
    serverNow: serverNow.toISOString(),
    roundStatus: round.status,
    roundEndAt: round.round_end_at,
    assignments,
    submissions,
    currentSubmissionId: currentSubmission?.id ?? null,
  });
}
