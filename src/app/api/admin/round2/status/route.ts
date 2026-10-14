import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Row = { entry_id: string; state: string; last_saved_at: string | null; final_submitted_at: string | null; twist_revealed_at: string | null; auto_submitted: boolean; submission_ref: string | null };

/** Live Round 2 board for admins: round state + one row per finalist. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    await db.rpc('round2_tick');
    const [round, quals, states, scores, questions, jobs] = await Promise.all([
      db.from('rounds').select('status, round_start_at, round_end_at, paused_at, total_paused_seconds').eq('round_number', 2).maybeSingle(),
      db.from('round2_qualifiers').select('entry_id, source, round1_rank, round1_score, entry:entries(entry_number, team_name, present, disqualified, team_members(member_position, full_name))').limit(500),
      db.from('round2_states').select('entry_id, state, last_saved_at, final_submitted_at, twist_revealed_at, auto_submitted, submission_ref').limit(500),
      db.from('judge_scores').select('entry_id, judge_id, total, locked').limit(5000),
      db.from('judge_questions').select('entry_id, answered_at').limit(5000),
      db.from('round2_eval_jobs').select('entry_id, status').limit(500),
    ]);
    if (round.error) throw round.error;
    if (quals.error) throw quals.error;
    const byEntry = new Map(((states.data ?? []) as Row[]).map((s) => [s.entry_id, s]));
    const teams = (quals.data ?? []).map((q) => {
      const entry = (Array.isArray(q.entry) ? q.entry[0] : q.entry) as { entry_number: number; team_name: string | null; present: boolean; disqualified: boolean; team_members: { member_position: number; full_name: string }[] } | null;
      const myScores = (scores.data ?? []).filter((s) => s.entry_id === q.entry_id);
      const myQ = (questions.data ?? []).filter((x) => x.entry_id === q.entry_id);
      return {
        entryId: q.entry_id, source: q.source, round1Rank: q.round1_rank, round1Score: q.round1_score,
        entryNumber: entry?.entry_number ?? null, teamName: entry?.team_name ?? null, present: entry?.present ?? false, disqualified: entry?.disqualified ?? false,
        members: (entry?.team_members ?? []).sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name),
        state: byEntry.get(q.entry_id) ?? null,
        juryScores: myScores.length, juryLocked: myScores.filter((s) => s.locked).length,
        juryAverage: myScores.length ? Math.round((myScores.reduce((a, s) => a + Number(s.total), 0) / myScores.length) * 10) / 10 : null,
        questions: myQ.length, unanswered: myQ.filter((x) => !x.answered_at).length,
        aiJob: (jobs.data ?? []).find((j) => j.entry_id === q.entry_id)?.status ?? null,
      };
    }).sort((a, b) => (a.entryNumber ?? 0) - (b.entryNumber ?? 0));
    return jsonOk({ serverNow: new Date().toISOString(), round: round.data, teams });
  } catch (err) {
    return serverError('round2 status', err, 'Could not load Round 2 status.');
  }
}
