import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Jury board: finalists with their stage, unanswered questions and (for judges) their own score. */
export async function GET() {
  const auth = await requireApiRole(['judge', 'admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    await db.rpc('round2_tick');
    const [round, cfg, states, scores, questions, assignments] = await Promise.all([
      db.from('rounds').select('status, round_end_at, paused_at').eq('round_number', 2).maybeSingle(),
      db.rpc('round2_preflight'),
      db.from('round2_states').select('entry_id, state, last_saved_at, final_submitted_at, entry:entries(entry_number, team_name, team_members(member_position, full_name))').limit(500),
      db.from('judge_scores').select('entry_id, judge_id, total, locked').limit(5000),
      db.from('judge_questions').select('entry_id, answered_at').limit(5000),
      db.from('round2_assignments').select('entry_id, problem_snapshot').limit(500),
    ]);
    if (states.error) throw states.error;
    const config = (cfg.data as { config?: Record<string, unknown> } | null)?.config ?? null;
    const teams = (states.data ?? []).map((s) => {
      const e = (Array.isArray(s.entry) ? s.entry[0] : s.entry) as { entry_number: number; team_name: string | null; team_members: { member_position: number; full_name: string }[] } | null;
      const a = (assignments.data ?? []).find((x) => x.entry_id === s.entry_id) as { problem_snapshot: { title?: string } | null } | undefined;
      const mine = (scores.data ?? []).find((x) => x.entry_id === s.entry_id && x.judge_id === auth.session.userId);
      const all = (scores.data ?? []).filter((x) => x.entry_id === s.entry_id);
      const qs = (questions.data ?? []).filter((x) => x.entry_id === s.entry_id);
      return {
        entryId: s.entry_id, entryNumber: e?.entry_number ?? null, teamName: e?.team_name ?? null,
        members: (e?.team_members ?? []).sort((x, y) => x.member_position - y.member_position).map((m) => m.full_name),
        state: s.state, lastSavedAt: s.last_saved_at, finalSubmittedAt: s.final_submitted_at,
        problemTitle: a?.problem_snapshot?.title ?? null,
        myScore: mine ? { total: Number(mine.total), locked: mine.locked } : null,
        scoreCount: all.length, questions: qs.length, unanswered: qs.filter((q) => !q.answered_at).length,
      };
    }).sort((x, y) => (x.entryNumber ?? 0) - (y.entryNumber ?? 0));
    return jsonOk({ serverNow: new Date().toISOString(), round: round.data, jury: (config as { jury?: unknown } | null)?.jury ?? null, role: auth.session.role, teams });
  } catch (err) {
    return serverError('jury teams', err, 'Could not load the jury board.');
  }
}
