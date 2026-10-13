import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError, uuidSchema } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Full Round 1 detail for one entry: every challenge, the prompt/output, AI score, overrides, job status. */
export async function GET(_req: NextRequest, { params }: { params: { entryId: string } }) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const entryId = uuidSchema.safeParse(params.entryId);
  if (!entryId.success) return jsonError('Entry not found.', 404);

  try {
    const db = supabaseAdmin();
    const { data: entry, error: entryErr } = await db
      .from('entries')
      .select('id, entry_number, registration_id, team_name, is_team, present, disqualified, team_members(member_position, full_name, email, phone, college, branch)')
      .eq('id', entryId.data)
      .maybeSingle();
    if (entryErr) throw entryErr;
    if (!entry) return jsonError('Entry not found.', 404);

    const { data: assignments, error: asgErr } = await db
      .from('challenge_assignments')
      .select('id, position, is_common, challenge:challenges(challenge_code, title, problem_statement, prompt_word_limit, output_char_limit)')
      .eq('entry_id', entry.id)
      .order('position', { ascending: true });
    if (asgErr) throw asgErr;

    const assignmentIds = (assignments ?? []).map((a) => a.id);
    const { data: submissions, error: subErr } = assignmentIds.length
      ? await db.from('submissions')
          .select('id, assignment_id, prompt_text, ai_output_text, status, question_start_at, question_end_at, submitted_at, submission_ref, last_saved_at')
          .in('assignment_id', assignmentIds)
      : { data: [], error: null };
    if (subErr) throw subErr;

    const submissionIds = (submissions ?? []).map((s) => s.id);
    const [aiEvals, reviews, jobs] = submissionIds.length
      ? await Promise.all([
          db.from('ai_evaluations').select('submission_id, prompt_clarity, context, specificity, creativity, constraint_handling, total, originality_score, plagiarism_flag, flags, summary, model, rubric_version, evaluated_at').in('submission_id', submissionIds),
          db.from('human_reviews').select('submission_id, old_total, new_total, reason, created_at').in('submission_id', submissionIds).order('created_at', { ascending: false }),
          db.from('evaluation_jobs').select('submission_id, status, retry_count, last_error, evaluated_at').in('submission_id', submissionIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

    const ps = (assignments ?? []).map((a) => {
      const submission = (submissions ?? []).find((s) => s.assignment_id === a.id) ?? null;
      const sid = submission?.id;
      return {
        assignment: a,
        submission,
        aiEval: sid ? (aiEvals.data ?? []).find((e) => e.submission_id === sid) ?? null : null,
        latestReview: sid ? (reviews.data ?? []).find((r) => r.submission_id === sid) ?? null : null,
        job: sid ? (jobs.data ?? []).find((j) => j.submission_id === sid) ?? null : null,
      };
    });
    return jsonOk({ entry, ps });
  } catch (err) {
    return serverError('entry detail', err, 'Could not load this entry.');
  }
}

const patchSchema = z.object({
  submissionId: z.string().uuid(),
  newTotal: z.number().finite().min(0).max(50),
  reason: z.string().trim().min(3).max(500),
});

/** Score override. Never overwrites the AI row — recorded as an auditable human_reviews entry. */
export async function PATCH(req: NextRequest, { params }: { params: { entryId: string } }) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const entryId = uuidSchema.safeParse(params.entryId);
  if (!entryId.success) return jsonError('Entry not found.', 404);
  const body = await readJson(req, patchSchema, 4096);
  if (!body.ok) return body.response;
  const { submissionId, newTotal, reason } = body.data;

  try {
    const db = supabaseAdmin();
    const { data: submission, error: sErr } = await db.from('submissions').select('id, entry_id').eq('id', submissionId).maybeSingle();
    if (sErr) throw sErr;
    if (!submission || submission.entry_id !== entryId.data) return jsonError('That submission does not belong to this entry.', 404);

    const [{ data: aiEval }, { data: lastReview }] = await Promise.all([
      db.from('ai_evaluations').select('total').eq('submission_id', submissionId).maybeSingle(),
      db.from('human_reviews').select('new_total').eq('submission_id', submissionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const { error } = await db.from('human_reviews').insert({
      submission_id: submissionId,
      reviewer_id: auth.session.userId,
      old_total: lastReview?.new_total ?? aiEval?.total ?? null,
      new_total: Math.round(newTotal * 10) / 10,
      reason,
    });
    if (error) throw error;
    await db.from('admin_actions').insert({
      admin_id: auth.session.userId, entry_id: entryId.data, action: 'score_override', reason,
      old_value: { total: lastReview?.new_total ?? aiEval?.total ?? null }, new_value: { total: newTotal, submission_id: submissionId },
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('score override', err, 'Could not save the score override.');
  }
}
