import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Returns the participant's current Round 1 state. Each challenge gets its
 * own server-authoritative timer (not one shared 30-minute clock) — the
 * "current" challenge is the first one still in 'draft' status, by
 * position. The very first time it becomes current, this endpoint lazily
 * starts its clock (question_start_at/question_end_at), clamped so it can
 * never run past the overall round deadline. The client never computes a
 * deadline itself — it only ever displays what this endpoint returns.
 */
export async function GET() {
  const session = requireRole('student');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const serverNow = new Date();

  const { data: round } = await db.from('rounds').select('*').eq('round_number', 1).single();
  if (!round || round.status !== 'running') {
    return NextResponse.json({ serverNow: serverNow.toISOString(), roundStatus: round?.status ?? 'not_started' });
  }

  const { data: assignments } = await db
    .from('challenge_assignments')
    .select(
      'id, position, challenge_id, locked_at, challenge:challenges(title, problem_statement, instructions, constraints, expected_output, prompt_word_limit, output_char_limit)'
    )
    .eq('entry_id', session.userId)
    .eq('round_id', round.id)
    .order('position', { ascending: true });

  let { data: submissions } = await db
    .from('submissions')
    .select('id, assignment_id, prompt_text, ai_output_text, status, question_start_at, question_end_at, submitted_at, submission_ref')
    .eq('entry_id', session.userId);

  const currentSubmission = (submissions ?? [])
    .slice()
    .sort((a, b) => {
      const posA = assignments?.find((x) => x.id === a.assignment_id)?.position ?? 0;
      const posB = assignments?.find((x) => x.id === b.assignment_id)?.position ?? 0;
      return posA - posB;
    })
    .find((s) => s.status === 'draft');

  // Lazily start the clock for whichever challenge just became current.
  if (currentSubmission && !currentSubmission.question_start_at) {
    const challengeSeconds = round.config?.challenge_seconds ?? 450;
    const roundEnd = round.round_end_at ? new Date(round.round_end_at).getTime() : Infinity;
    const start = serverNow;
    const naturalEnd = start.getTime() + challengeSeconds * 1000;
    const end = new Date(Math.min(naturalEnd, roundEnd));

    await db
      .from('submissions')
      .update({ question_start_at: start.toISOString(), question_end_at: end.toISOString() })
      .eq('id', currentSubmission.id);

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
