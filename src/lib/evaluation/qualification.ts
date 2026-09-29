import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * Sums each entry's Round 1 AI evaluation (+ any human_reviews override,
 * which always wins over the AI score) across its 4 assigned challenges,
 * writes round_results, and marks the top `qualificationPercent`% as
 * qualified. Ties at the cutoff are all included (nobody is cut mid-tie).
 */
export async function computeRound1Results(roundId: string, qualificationPercent = 15) {
  const db = supabaseAdmin();

  const { data: assignments, error: asgErr } = await db
    .from('challenge_assignments')
    .select('id, entry_id')
    .eq('round_id', roundId);
  if (asgErr) throw asgErr;

  const { data: submissions, error: subErr } = await db
    .from('submissions')
    .select('id, assignment_id, entry_id, status')
    .eq('status', 'submitted');
  if (subErr) throw subErr;

  const { data: aiEvals, error: aiErr } = await db.from('ai_evaluations').select('submission_id, total');
  if (aiErr) throw aiErr;
  const aiBySubmission = new Map((aiEvals ?? []).map((e) => [e.submission_id, e.total]));

  const { data: reviews, error: revErr } = await db
    .from('human_reviews')
    .select('submission_id, new_total, created_at')
    .order('created_at', { ascending: false });
  if (revErr) throw revErr;
  const latestReviewBySubmission = new Map<string, number>();
  for (const r of reviews ?? []) {
    if (!latestReviewBySubmission.has(r.submission_id)) {
      latestReviewBySubmission.set(r.submission_id, r.new_total);
    }
  }

  const totalsByEntry = new Map<string, number>();
  for (const sub of submissions ?? []) {
    const score = latestReviewBySubmission.get(sub.id) ?? aiBySubmission.get(sub.id) ?? 0;
    totalsByEntry.set(sub.entry_id, (totalsByEntry.get(sub.entry_id) ?? 0) + score);
  }

  const ranked = [...totalsByEntry.entries()].sort((a, b) => b[1] - a[1]);
  const qualifyCount = Math.max(1, Math.ceil((ranked.length * qualificationPercent) / 100));
  const cutoffScore = ranked[qualifyCount - 1]?.[1] ?? 0;

  const rows = ranked.map(([entry_id, score], idx) => ({
    entry_id,
    round_id: roundId,
    score,
    rank: idx + 1,
    qualified: score >= cutoffScore, // ties at the cutoff all qualify
    computed_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    await db.from('round_results').upsert(rows, { onConflict: 'entry_id,round_id' });
  }

  return { totalEntries: rows.length, qualifyCount, cutoffScore };
}
