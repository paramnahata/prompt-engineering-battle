import { NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, serverError, uuidSchema } from '@/lib/http';
import { suggestJuryQuestions } from '@/lib/round2/questions';

export const dynamic = 'force-dynamic';

/** One finalist's full Round 2 work for the jury: problem (incl. private criteria), twist, drafts, Q&A, scores. */
export async function GET(_req: NextRequest, { params }: { params: { entryId: string } }) {
  const auth = await requireApiRole(['judge', 'admin']);
  if (!auth.ok) return auth.response;
  const entryId = uuidSchema.safeParse(params.entryId);
  if (!entryId.success) return jsonError('Team not found.', 404);
  try {
    const db = supabaseAdmin();
    const [state, asg, entry, questions, scores, ai, reviews] = await Promise.all([
      db.from('round2_states').select('state, initial_prompt, initial_output, final_prompt, final_output, rationale, twist_snapshot, twist_revealed_at, initial_submitted_at, final_submitted_at, last_saved_at, submission_ref, auto_submitted').eq('entry_id', entryId.data).maybeSingle(),
      db.from('round2_assignments').select('problem_snapshot').eq('entry_id', entryId.data).maybeSingle(),
      db.from('entries').select('entry_number, team_name, team_members(member_position, full_name, college)').eq('id', entryId.data).maybeSingle(),
      db.from('judge_questions').select('id, question, answer, asked_at, answered_at, judge:judges(full_name), admin:admins(full_name)').eq('entry_id', entryId.data).order('asked_at'),
      db.from('judge_scores').select('judge_id, understanding, response_quality, adaptability, interaction, total, max_total, question_scores, notes, locked, saved_at, judge:judges(full_name)').eq('entry_id', entryId.data),
      auth.session.role === 'admin' ? db.from('round2_ai_evaluations').select('*').eq('entry_id', entryId.data).maybeSingle() : Promise.resolve({ data: null }),
      auth.session.role === 'admin' ? db.from('round2_reviews').select('old_score, new_score, reason, created_at').eq('entry_id', entryId.data).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    if (state.error) throw state.error;
    if (!state.data || !entry.data) return jsonError('That team is not in Round 2.', 404);
    // Judges see their own score in full and only totals of other judges; admins see everything.
    const allScores = (scores.data ?? []).map((s) => {
      const judge = Array.isArray(s.judge) ? s.judge[0] : s.judge;
      const mine = s.judge_id === auth.session.userId;
      return auth.session.role === 'admin' || mine
        ? { ...s, judge: judge?.full_name ?? null, mine }
        : { judge_id: s.judge_id, judge: judge?.full_name ?? null, total: s.total, max_total: s.max_total, locked: s.locked, mine: false };
    });
    const problem = (asg.data?.problem_snapshot ?? null) as Record<string, string | null> | null;
    const twist = state.data.twist_snapshot as { title?: string; description?: string } | null;
    return jsonOk({
      entry: entry.data, work: state.data, problem,
      suggestions: suggestJuryQuestions({ problem, twist: state.data.twist_revealed_at ? twist : null, work: state.data }),
      questions: (questions.data ?? []).map((q) => {
        const j = Array.isArray(q.judge) ? q.judge[0] : q.judge;
        const a = Array.isArray(q.admin) ? q.admin[0] : q.admin;
        return { id: q.id, question: q.question, answer: q.answer, askedAt: q.asked_at, answeredAt: q.answered_at, askedBy: j?.full_name ?? a?.full_name ?? 'Organizer' };
      }),
      scores: allScores, ai: ai.data ?? null, reviews: reviews.data ?? [],
    });
  } catch (err) {
    return serverError('jury team', err, 'Could not load this team.');
  }
}
