import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Full Round 1 detail for one entry: every PS, the prompt/output they submitted, and the current score. */
export async function GET(_req: NextRequest, { params }: { params: { entryId: string } }) {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const { entryId } = params;

  const { data: entry, error: entryErr } = await db
    .from('entries')
    .select('id, entry_code, team_name, is_team, present, disqualified, team_members(member_position, full_name)')
    .eq('id', entryId)
    .single();
  if (entryErr || !entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

  const { data: assignments, error: asgErr } = await db
    .from('challenge_assignments')
    .select('id, position, is_common, challenges:challenges(title, problem_statement, prompt_word_limit, output_char_limit)')
    .eq('entry_id', entryId)
    .order('position', { ascending: true });
  if (asgErr) return NextResponse.json({ error: asgErr.message }, { status: 500 });

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const { data: submissions } = await db
    .from('submissions')
    .select('id, assignment_id, prompt_text, ai_output_text, status, submitted_at, submission_ref')
    .in('assignment_id', assignmentIds.length > 0 ? assignmentIds : ['00000000-0000-0000-0000-000000000000']);

  const submissionIds = (submissions ?? []).map((s) => s.id);
  const { data: aiEvals } = await db
    .from('ai_evaluations')
    .select('*')
    .in('submission_id', submissionIds.length > 0 ? submissionIds : ['00000000-0000-0000-0000-000000000000']);

  const { data: reviews } = await db
    .from('human_reviews')
    .select('submission_id, old_total, new_total, reason, created_at')
    .in('submission_id', submissionIds.length > 0 ? submissionIds : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: false });

  const ps = (assignments ?? []).map((a) => {
    const submission = (submissions ?? []).find((s) => s.assignment_id === a.id) ?? null;
    const aiEval = submission ? (aiEvals ?? []).find((e) => e.submission_id === submission.id) ?? null : null;
    const latestReview = submission ? (reviews ?? []).find((r) => r.submission_id === submission.id) ?? null : null;
    return { assignment: a, submission, aiEval, latestReview };
  });

  return NextResponse.json({ entry, ps });
}

const patchSchema = z.object({
  submissionId: z.string().uuid(),
  newTotal: z.number().min(0).max(50),
  reason: z.string().min(1),
});

/** Admin overrides a submission's score. Never overwrites the AI score row — recorded as a human_reviews entry instead. */
export async function PATCH(req: NextRequest) {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { submissionId, newTotal, reason } = parsed.data;

  const db = supabaseAdmin();
  const { data: aiEval } = await db.from('ai_evaluations').select('total').eq('submission_id', submissionId).single();

  const { error } = await db.from('human_reviews').insert({
    submission_id: submissionId,
    reviewer_id: session.userId,
    old_total: aiEval?.total ?? null,
    new_total: newTotal,
    reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
