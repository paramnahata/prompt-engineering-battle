import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * Returns the participant's current Round 1 state: which challenge they're
 * on, its server-authoritative deadline, and their saved draft — everything
 * the client needs to resync after a refresh/reconnect without trusting
 * anything the browser computed on its own.
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
    .select('id, position, challenge_id, locked_at, challenges(title, problem_statement, instructions, constraints, expected_output, prompt_word_limit, output_char_limit)')
    .eq('entry_id', session.userId)
    .eq('round_id', round.id)
    .order('position', { ascending: true });

  const { data: submissions } = await db
    .from('submissions')
    .select('id, assignment_id, prompt_text, ai_output_text, status, question_start_at, question_end_at, submitted_at')
    .eq('entry_id', session.userId);

  return NextResponse.json({
    serverNow: serverNow.toISOString(),
    roundStatus: round.status,
    roundEndAt: round.round_end_at,
    assignments,
    submissions,
  });
}
