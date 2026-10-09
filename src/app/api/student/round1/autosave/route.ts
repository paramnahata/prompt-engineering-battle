import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

const bodySchema = z.object({
  submissionId: z.string().uuid(),
  promptText: z.string().max(20_000),
  aiOutputText: z.string().max(20_000),
});

export async function POST(req: NextRequest) {
  const session = requireRole('student');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { submissionId, promptText, aiOutputText } = parsed.data;

  const db = supabaseAdmin();

  // Ownership + lock check — never allow saving into someone else's
  // submission, or a challenge whose timer has expired.
  const { data: submission, error } = await db
    .from('submissions')
    .select('id, entry_id, status, question_end_at, assignment_id')
    .eq('id', submissionId)
    .single();
  if (error || !submission) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (submission.entry_id !== session.userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (submission.status !== 'draft') {
    return NextResponse.json({ error: 'locked' }, { status: 409 });
  }
  if (submission.question_end_at && new Date(submission.question_end_at) <= new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 409 });
  }

  // Enforce this challenge's per-PS limits server-side — a client-side
  // word counter alone can be bypassed via devtools.
  const { data: assignment } = await db
    .from('challenge_assignments')
    .select('challenge_id, round_id')
    .eq('id', submission.assignment_id)
    .single();
  if (assignment) {
    const { data: round } = await db.from('rounds').select('status').eq('id', assignment.round_id).single();
    if (!round || round.status !== 'running') {
      return NextResponse.json({ error: 'Round 1 has ended. Your changes can no longer be saved.', roundEnded: true }, { status: 409 });
    }
    const { data: challenge } = await db
      .from('challenges')
      .select('prompt_word_limit, output_char_limit')
      .eq('id', assignment.challenge_id)
      .single();
    if (challenge) {
      const wordCount = promptText.trim().length === 0 ? 0 : promptText.trim().split(/\s+/).length;
      if (wordCount > challenge.prompt_word_limit) {
        return NextResponse.json(
          { error: `Prompt exceeds the ${challenge.prompt_word_limit}-word limit for this challenge (currently ${wordCount}).` },
          { status: 422 }
        );
      }
      if (aiOutputText.length > challenge.output_char_limit) {
        return NextResponse.json(
          { error: `AI output exceeds the ${challenge.output_char_limit}-character limit for this challenge.` },
          { status: 422 }
        );
      }
    }
  }

  const now = new Date().toISOString();

  await db
    .from('submissions')
    .update({ prompt_text: promptText, ai_output_text: aiOutputText, last_saved_at: now })
    .eq('id', submissionId);

  // Keep a lightweight version trail (not on every keystroke — this route
  // itself is already called at most every ~5s by the client debounce).
  await db.from('submission_versions').insert({
    submission_id: submissionId,
    prompt_text: promptText,
    ai_output_text: aiOutputText,
    saved_at: now,
  });

  return NextResponse.json({ savedAt: now });
}
